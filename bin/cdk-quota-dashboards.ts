import * as cdk from 'aws-cdk-lib';
import { CdkQuotaDashboardsStack } from '../lib/cdk-quota-dashboards-stack';
import { AwsSolutionsChecks } from 'cdk-nag';

const app = new cdk.App();

// Add cdk-nag security and best practice checks
cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

new CdkQuotaDashboardsStack(app, 'CdkQuotaDashboardsStack', {
  /* Use environment variables to match deployment region */
  env: { 
    account: process.env.CDK_DEFAULT_ACCOUNT, 
    region: process.env.CDK_DEFAULT_REGION || process.env.AWS_DEFAULT_REGION
  },

  /* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */
  
  // Stack-level tags (applied to the CloudFormation stack itself)
  tags: {
    Project: 'BedrockQuotaDashboard'
  }
});