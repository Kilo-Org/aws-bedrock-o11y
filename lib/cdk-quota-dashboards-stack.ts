import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';
import { BEDROCK_MODELS, getQuotaCodes, type EndpointType, validateModelEndpointSupport, getSupportedEndpointTypes } from './bedrock-registries';

// Dashboard configuration interface
interface DashboardConfig {
  /**
   * The Bedrock model configuration object from the registry
   * @example BEDROCK_MODELS.AMAZON.NOVA_LITE_V1
   * @example BEDROCK_MODELS.ANTHROPIC.CLAUDE_3_HAIKU
   */
  modelConfig: any; // Model config object with modelId, outputTokenBurndownRate, and quota properties
  
  /**
   * The endpoint type for this model. Must be supported by the model.
   * Use getSupportedEndpointTypes(modelConfig) to check valid options.
   * 
   * - 'regional': Standard regional endpoints
   * - 'cross-region': Cross-region inference
   * - 'global-cross-region': Global cross-region
   * 
   * @example 'regional'
   * @example 'cross-region' 
   * @example 'global-cross-region'
   */
  endpointType: EndpointType;
}

/**
 * Validates that all dashboard configurations use valid model/endpoint combinations
 * @param configs Array of dashboard configurations to validate
 * @throws Error with detailed message if any configurations are invalid
 */
function validateAllDashboardConfigs(configs: DashboardConfig[]): void {
  const errors: string[] = [];
  
  configs.forEach((config, index) => {
    if (!validateModelEndpointSupport(config.modelConfig, config.endpointType)) {
      const supported = getSupportedEndpointTypes(config.modelConfig);
      if (supported.length === 0) {
        errors.push(`Config ${index}: Model '${config.modelConfig.modelId}' not found in quota registry`);
      } else {
        errors.push(`Config ${index}: Model '${config.modelConfig.modelId}' does not support endpoint type '${config.endpointType}'. Supported types: ${supported.join(', ')}`);
      }
    }
  });
  
  if (errors.length > 0) {
    throw new Error(`Invalid dashboard configurations found:\n${errors.join('\n')}\n\nPlease check the quota mappings in the region-specific registry file for valid model/endpoint combinations.`);
  }
}

// Helper function to generate full model ID with endpoint prefix
function getFullModelId(modelConfig: any, endpointType: EndpointType): string {
  const modelId = modelConfig.modelId;
  switch (endpointType) {
    case 'regional':
      return modelId;
    case 'cross-region':
      return `us.${modelId}`;
    case 'global-cross-region':
      return `global.${modelId}`;
    default:
      return modelId;
  }
}

export interface CdkQuotaDashboardsStackProps extends cdk.StackProps {
}

export class CdkQuotaDashboardsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: CdkQuotaDashboardsStackProps) {
    super(scope, id, props);

    // All available dashboard configurations
    // NOTE: Each model/endpoint combination is validated at runtime.
    // If you add a new configuration, ensure the model supports the specified endpoint type.
    // Use getSupportedEndpointTypes(modelConfig) to check valid options for a model.
    const allDashboardConfigs: DashboardConfig[] = [

      // Amazon Nova 2 Models
      { modelConfig: BEDROCK_MODELS.AMAZON.NOVA_2_LITE_V1, endpointType: 'cross-region' },

      // Anthropic Claude 4 Models (cross-region only)
      { modelConfig: BEDROCK_MODELS.ANTHROPIC.CLAUDE_HAIKU_4_5, endpointType: 'cross-region' },
      { modelConfig: BEDROCK_MODELS.ANTHROPIC.CLAUDE_SONNET_4_5, endpointType: 'cross-region' },
      { modelConfig: BEDROCK_MODELS.ANTHROPIC.CLAUDE_OPUS_4_5, endpointType: 'cross-region' },

    ];

    // Validate all dashboard configurations before proceeding
    validateAllDashboardConfigs(allDashboardConfigs);

    const dashboardConfigs = allDashboardConfigs;

    // Lambda function to fetch Service Quotas and publish as CloudWatch metrics
    const quotaFetcherLambda = new lambda.Function(this, 'QuotaFetcher', {
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'quota-fetcher-lambda.handler',
      timeout: cdk.Duration.minutes(10),
      code: lambda.Code.fromAsset('lib/lambda'),
      architecture: lambda.Architecture.ARM_64, // Use ARM64 for better price-performance
    });

    // Grant permissions to fetch service quotas and publish CloudWatch metrics
    quotaFetcherLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['servicequotas:GetServiceQuota', 'servicequotas:ListServiceQuotas'],
        resources: [`*`], // Quotas does not support resource-level permissions
      })
    );

    quotaFetcherLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
        conditions: {
          StringEquals: {
            'cloudwatch:namespace': 'Bedrock/Quotas'
          }
        }
      })
    );

    // Custom Resource Provider
    const quotaProvider = new cr.Provider(this, 'QuotaProvider', {
      onEventHandler: quotaFetcherLambda,
    });

    // EventBridge rule to refresh quotas every 2.9 hours
    const dailyRefreshRule = new events.Rule(this, 'DailyQuotaRefresh', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(174)),
      description: 'Refresh Bedrock quota values every 2.9 hours',
    });

    // Prepare models for EventBridge rule with error handling
    const eventBridgeModels = dashboardConfigs.map(config => {
      const quotaCodes = getQuotaCodes(config.modelConfig, config.endpointType);
      const fullModelId = getFullModelId(config.modelConfig, config.endpointType);

      if (!quotaCodes) {
        console.warn(`[EVENTBRIDGE_WARNING] Excluding model '${config.modelConfig.modelId}' (${config.endpointType}) from scheduled quota refresh - missing quota codes`);
        return null;
      }

      return {
        modelId: fullModelId,
        tokenQuotaCode: quotaCodes.tokenQuotaCode,
        requestQuotaCode: quotaCodes.requestQuotaCode,
      };
    }).filter(Boolean); // Remove null entries

    if (eventBridgeModels.length === 0) {
      console.error('[EVENTBRIDGE_ERROR] No models available for scheduled quota refresh due to missing quota codes');
    } else {
      console.log(`[EVENTBRIDGE_SUCCESS] Configured scheduled quota refresh for ${eventBridgeModels.length} models`);
    }

    dailyRefreshRule.addTarget(
      new targets.LambdaFunction(quotaFetcherLambda, {
        event: events.RuleTargetInput.fromObject({
          source: 'aws.events',
          models: eventBridgeModels,
        }),
      })
    );

    // Create CloudWatch Dashboard
    const dashboard = new cloudwatch.Dashboard(this, 'BedrockQuotaDashboard', {
      dashboardName: 'BedrockQuotaConsumptionByModel',
      periodOverride: cloudwatch.PeriodOverride.INHERIT,
    });

    // Prepare models for initial quota fetch with error handling
    const customResourceModels = dashboardConfigs.map(config => {
      const quotaCodes = getQuotaCodes(config.modelConfig, config.endpointType);
      const fullModelId = getFullModelId(config.modelConfig, config.endpointType);

      if (!quotaCodes) {
        console.warn(`[CUSTOM_RESOURCE_WARNING] Excluding model '${config.modelConfig.modelId}' (${config.endpointType}) from initial quota fetch - missing quota codes`);
        return null;
      }

      return {
        modelId: fullModelId,
        tokenQuotaCode: quotaCodes.tokenQuotaCode,
        requestQuotaCode: quotaCodes.requestQuotaCode,
      };
    }).filter(Boolean); // Remove null entries

    if (customResourceModels.length === 0) {
      console.error('[CUSTOM_RESOURCE_ERROR] No models available for initial quota fetch due to missing quota codes');
    } else {
      console.log(`[CUSTOM_RESOURCE_SUCCESS] Configured initial quota fetch for ${customResourceModels.length} models`);
    }

    // Trigger initial quota fetch on first deployment
    new cdk.CustomResource(this, 'InitialQuotaFetch', {
      serviceToken: quotaProvider.serviceToken,
      properties: {
        models: customResourceModels,
      },
    });

    // Helper to determine model family for banners
    const getModelFamily = (modelId: string): string => {
      if (modelId.startsWith('amazon.nova-')) return 'Amazon Nova';
      if (modelId.startsWith('amazon.titan-')) return 'Amazon Titan';
      if (modelId.startsWith('anthropic.claude')) return 'Anthropic Claude';
      if (modelId.startsWith('meta')) return 'Meta';
      if (modelId.startsWith('mistral.')) return 'Mistral AI';
      if (modelId.startsWith('cohere.')) return 'Cohere';
      if (modelId.startsWith('ai21.')) return 'AI21 Labs';
      if (modelId.startsWith('deepseek.')) return 'DeepSeek';
      if (modelId.startsWith('google.')) return 'Google';
      if (modelId.startsWith('nvidia.')) return 'NVIDIA';
      if (modelId.startsWith('openai.')) return 'OpenAI';
      if (modelId.startsWith('qwen.')) return 'Qwen';
      if (modelId.startsWith('kimi.')) return 'Kimi';
      if (modelId.startsWith('minimax.')) return 'Minimax';
      if (modelId.startsWith('magistral.')) return 'Magistral';
      return 'Other Models';
    };

    // Track current family to add banners
    let currentFamily: string | null = null;

    // Track models with missing quota codes for summary logging
    const modelsWithMissingQuotas: string[] = [];

    // Create widgets for each dashboard configuration
    dashboardConfigs.forEach((config) => {
      const fullModelId = getFullModelId(config.modelConfig, config.endpointType);
      const quotaCodes = getQuotaCodes(config.modelConfig, config.endpointType);
      const modelFamily = getModelFamily(config.modelConfig.modelId);

      // Skip if no quota codes found
      if (!quotaCodes) {
        console.warn(`[QUOTA_ERROR] Model '${config.modelConfig.modelId}' does not support endpoint type '${config.endpointType}' or quota codes are missing`);
        modelsWithMissingQuotas.push(`${config.modelConfig.modelId} (${config.endpointType})`);
        return;
      }

      // Get burndown rate from model config
      const burndownRate = config.modelConfig.outputTokenBurndownRate;

      // Add banner when entering a new model family
      if (modelFamily !== currentFamily) {
        currentFamily = modelFamily;
        dashboard.addWidgets(
          new cloudwatch.TextWidget({
            markdown: `# ${modelFamily}`,
            width: 24,
            height: 1,
          })
        );
      }

      // Create CloudWatch metrics for quota values (updated daily by Lambda)
      const tokenQuotaMetric = new cloudwatch.Metric({
        namespace: 'Bedrock/Quotas',
        metricName: 'TokenQuota',
        dimensionsMap: {
          ModelId: fullModelId,
        },
        statistic: 'Maximum',
        period: cdk.Duration.minutes(1),
        label: 'Quota Limit',
        color: cloudwatch.Color.RED,
      });

      const requestQuotaMetric = new cloudwatch.Metric({
        namespace: 'Bedrock/Quotas',
        metricName: 'RequestQuota',
        dimensionsMap: {
          ModelId: fullModelId,
        },
        statistic: 'Maximum',
        period: cdk.Duration.minutes(1),
        label: 'Quota Limit',
        color: cloudwatch.Color.RED,
      });



      // Create metrics
      const inputTokens = new cloudwatch.Metric({
        namespace: 'AWS/Bedrock',
        metricName: 'InputTokenCount',
        dimensionsMap: {
          ModelId: fullModelId,
        },
        statistic: 'Sum',
        period: cdk.Duration.minutes(1),
      });

      const cacheWriteTokens = new cloudwatch.Metric({
        namespace: 'AWS/Bedrock',
        metricName: 'CacheWriteInputTokenCount',
        dimensionsMap: {
          ModelId: fullModelId,
        },
        statistic: 'Sum',
        period: cdk.Duration.minutes(1),
      });

      const outputTokens = new cloudwatch.Metric({
        namespace: 'AWS/Bedrock',
        metricName: 'OutputTokenCount',
        dimensionsMap: {
          ModelId: fullModelId,
        },
        statistic: 'Sum',
        period: cdk.Duration.minutes(1),
      });

      // Calculate total quota consumption with burndown rate
      const quotaTokenUsage = new cloudwatch.MathExpression({
        expression: `inputTokens + cacheWriteTokens + (outputTokens * ${burndownRate})`,
        usingMetrics: {
          inputTokens: inputTokens,
          cacheWriteTokens: cacheWriteTokens,
          outputTokens: outputTokens,
        },
        label: 'Quota Consumption (Tokens)',
        period: cdk.Duration.minutes(1),
      });

      // Create request count metric
      const invocations = new cloudwatch.Metric({
        namespace: 'AWS/Bedrock',
        metricName: 'Invocations',
        dimensionsMap: {
          ModelId: fullModelId,
        },
        statistic: 'Sum',
        period: cdk.Duration.minutes(1),
      });

      // Wrap quota metrics with FILL to create continuous horizontal lines
      const tokenQuotaLine = new cloudwatch.MathExpression({
        expression: 'FILL(tokenQuota, REPEAT)',
        usingMetrics: {
          tokenQuota: tokenQuotaMetric,
        },
        label: 'Quota Limit (Tokens)',
        color: cloudwatch.Color.RED,
        period: cdk.Duration.minutes(1),
      });

      const requestQuotaLine = new cloudwatch.MathExpression({
        expression: 'FILL(requestQuota, REPEAT)',
        usingMetrics: {
          requestQuota: requestQuotaMetric,
        },
        label: 'Quota Limit (Requests)',
        color: cloudwatch.Color.RED,
        period: cdk.Duration.minutes(1),
      });

      // Add widgets to dashboard with quota metrics on left axis
      dashboard.addWidgets(
        new cloudwatch.GraphWidget({
          title: `${fullModelId} - Token Quota Consumption`,
          left: [quotaTokenUsage, tokenQuotaLine],
          width: 12,
          height: 6,
          leftYAxis: {
            label: 'Quota Units (Tokens/min)',
            min: 0,
          },
          period: cdk.Duration.minutes(1),
        }),
        new cloudwatch.GraphWidget({
          title: `${fullModelId} - Request Quota Consumption`,
          left: [invocations, requestQuotaLine],
          width: 12,
          height: 6,
          leftYAxis: {
            label: 'Quota Units (Requests/min)',
            min: 0,
          },
          period: cdk.Duration.minutes(1),
        })
      );


    });

    // Log summary of models with missing data
    if (modelsWithMissingQuotas.length > 0) {
      console.warn(`[DASHBOARD_GENERATION_WARNING] Skipped ${modelsWithMissingQuotas.length} dashboard widget(s) due to missing quota codes:`);
      modelsWithMissingQuotas.forEach(model => {
        console.warn(`  - ${model}`);
      });
      console.warn('Dashboard generation continued with remaining models. To fix this, ensure the model supports the specified endpoint type in the region-specific registry file.');
    }

    const totalConfigured = dashboardConfigs.length;
    const totalSkipped = modelsWithMissingQuotas.length;
    const totalCreated = totalConfigured - totalSkipped;

    if (totalSkipped > 0) {
      console.warn(`[DASHBOARD_GENERATION_SUMMARY] Created ${totalCreated} dashboard widgets, skipped ${totalSkipped} due to missing data (${totalConfigured} total configured)`);
    } else {
      console.log(`[DASHBOARD_GENERATION_SUCCESS] Successfully created ${totalCreated} dashboard widgets for all configured models`);
    }

    // Output dashboard URL
    new cdk.CfnOutput(this, 'DashboardURL', {
      value: `https://console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=BedrockQuotaConsumptionByModel`,
      description: 'CloudWatch Dashboard URL',
    });

    new cdk.CfnOutput(this, 'DashboardName', {
      value: dashboard.dashboardName,
      description: 'Dashboard Name',
    });

    // Stack-level suppressions for all IAM issues
    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'AwsSolutions-IAM4',
        reason: 'AWS managed policy AWSLambdaBasicExecutionRole is required for Lambda execution and Custom Resource Provider',
        appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole']
      },
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Service Quotas API and CloudWatch PutMetricData require wildcard permissions as they do not support resource-level permissions. Custom Resource Provider requires Lambda invoke permissions with version suffix wildcard.',
        appliesTo: ['Resource::*', 'Resource::<QuotaFetcher87D05653.Arn>:*']
      }
    ]);
  }
}
