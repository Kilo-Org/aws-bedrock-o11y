// Bedrock Model and Quota Registries
// This file imports the region-specific model registry
// 
// TO DEPLOY TO A DIFFERENT REGION:
// 1. Create a new region file in ./bedrock-registries/ (e.g., us-west-2.ts)
// 2. Update the import below to point to your target region
// 3. Deploy your CDK stack

// CURRENT REGION: US-East-1
// Change this import to deploy to a different region:
export * from './bedrock-registries/us-east-1';

// For other regions, uncomment the appropriate line:
// export * from './bedrock-registries/us-west-2';  // ✅ Available
// export * from './bedrock-registries/eu-west-1';
// export * from './bedrock-registries/ap-southeast-1';