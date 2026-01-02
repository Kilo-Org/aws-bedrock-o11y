#!/usr/bin/env ts-node
import { 
  ServiceQuotasClient, 
  ListServiceQuotasCommand, 
  ServiceQuota,
  ListServiceQuotasCommandOutput 
} from '@aws-sdk/client-service-quotas';
import { writeFileSync } from 'fs';

async function getAllBedrockQuotas(region?: string) {
  const targetRegion = region || process.env.AWS_DEFAULT_REGION || 'us-east-1';
  const client = new ServiceQuotasClient({ 
    region: targetRegion 
  });
  
  try {
    console.log(`Fetching all Bedrock Service Quotas for region: ${targetRegion}...\n`);
    
    let allQuotas: ServiceQuota[] = [];
    let nextToken: string | undefined = undefined;
    
    // Paginate through all results
    do {
      const response: ListServiceQuotasCommandOutput = await client.send(new ListServiceQuotasCommand({
        ServiceCode: 'bedrock',
        NextToken: nextToken,
        MaxResults: 100,
      }));
      
      if (response.Quotas) {
        allQuotas = allQuotas.concat(response.Quotas);
      }
      
      nextToken = response.NextToken;
    } while (nextToken);
    
    if (allQuotas.length === 0) {
      console.log('No quotas found for Bedrock service.');
      return;
    }
    
    console.log(`Found ${allQuotas.length} total Bedrock quotas\n`);
    
    // Display all quotas
    console.log('All Bedrock Quotas:\n');
    console.log('Code'.padEnd(15), 'Value'.padEnd(15), 'Name');
    console.log('-'.repeat(100));
    
    allQuotas.forEach(quota => {
      console.log(
        (quota.QuotaCode || 'N/A').padEnd(15),
        (quota.Value?.toString() || 'N/A').padEnd(15),
        quota.QuotaName || 'N/A'
      );
    });
    
    // Save to file with timestamp and region
    const timestamp = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const regionSuffix = region ? `-${region}` : '';
    const filename = `bedrock-quota-codes-${timestamp}${regionSuffix}.txt`;
    
    let output = `Fetching all Bedrock Service Quotas for region: ${targetRegion}...\n\n`;
    output += `Found ${allQuotas.length} total quotas\n\n`;
    output += `All Bedrock Quotas:\n\n`;
    output += `${'Code'.padEnd(15)} ${'Value'.padEnd(15)} Name\n`;
    output += `${'-'.repeat(100)}\n`;
    
    allQuotas.forEach(quota => {
      output += `${(quota.QuotaCode || 'N/A').padEnd(15)} ${(quota.Value?.toString() || 'N/A').padEnd(15)} ${quota.QuotaName || 'N/A'}\n`;
    });
    
    writeFileSync(filename, output);
    console.log(`\nQuotas saved to: ${filename}`);
    
  } catch (error) {
    console.error('Error fetching quotas:', error);
    console.log('\nMake sure you have:');
    console.log('1. AWS credentials configured');
    console.log('2. Permissions for service-quotas:ListServiceQuotas');
    console.log('3. Bedrock service available in your region');
  }
}

// Show usage if --help is passed
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Usage: npx ts-node scripts/get-quota-codes.ts [region]');
  console.log('\nFetches all AWS Bedrock service quotas and saves them to a timestamped file.');
  console.log('\nOptional region parameter (defaults to us-east-1 or AWS_DEFAULT_REGION)');
  console.log('\nOutput file format: bedrock-quota-codes-YYYYMMDD-[region].txt');
  process.exit(0);
}

// Get region from command line argument
const region = process.argv[2];

getAllBedrockQuotas(region);
