#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { LambdaApiStack } from '../lib/lambda-api-stack';

// Get environment from command line or default to 'dev'
const app = new cdk.App();
const environment = app.node.tryGetContext('env') || 'dev';

console.log(`Deploying to ${environment} environment`);

// Parse A record IPs from environment variable with robust error handling
let aRecordIps;
try {
  if (process.env.CDK_A_RECORD_IPS) {
    // Try to parse as JSON
    try {
      aRecordIps = JSON.parse(process.env.CDK_A_RECORD_IPS);
    } catch (jsonError) {
      // If JSON parsing fails, try to parse as comma-separated string
      console.error(`Error parsing CDK_A_RECORD_IPS as JSON: ${jsonError}`);
      console.log(`Trying to parse CDK_A_RECORD_IPS as comma-separated string: ${process.env.CDK_A_RECORD_IPS}`);
      aRecordIps = process.env.CDK_A_RECORD_IPS.split(',').map((ip: string) => ip.trim());
    }
  } else {
    // Use context value or default
    aRecordIps = JSON.parse(app.node.tryGetContext('a_record_ips') || '["192.168.1.1", "192.168.1.2", "192.168.1.3"]');
  }
  
  // Validate that we have valid IPs
  aRecordIps = aRecordIps.filter((ip: string) => {
    // Simple IP validation regex
    return /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(ip);
  });
  
  console.log(`Parsed A record IPs: ${JSON.stringify(aRecordIps)}`);
  
  if (aRecordIps.length === 0) {
    console.warn('No valid IPs found, using default IPs');
    aRecordIps = ["192.168.1.1", "192.168.1.2", "192.168.1.3"]; // Default fallback
  }
} catch (e) {
  console.error('Error processing A_RECORD_IPS:', e);
  aRecordIps = ["192.168.1.1", "192.168.1.2", "192.168.1.3"]; // Default fallback
}

// Parse DNS servers from environment variable
let dnsServers;
try {
  dnsServers = process.env.CDK_DNS_SERVERS ? 
    JSON.parse(process.env.CDK_DNS_SERVERS) : 
    JSON.parse(app.node.tryGetContext('dns_servers') || '["8.8.8.8", "8.8.4.4"]');
} catch (e) {
  console.error('Error parsing DNS_SERVERS:', e);
  dnsServers = ["8.8.8.8", "8.8.4.4"]; // Default fallback
}

// Set context values from environment variables
app.node.setContext('env', environment);
app.node.setContext('listener_arn', process.env.CDK_LISTENER_ARN || app.node.tryGetContext('listener_arn'));
app.node.setContext('target_group_arn', process.env.CDK_TARGET_GROUP_ARN || app.node.tryGetContext('target_group_arn'));
app.node.setContext('elb_endpoint', process.env.CDK_ELB_ENDPOINT || app.node.tryGetContext('elb_endpoint'));
app.node.setContext('verify_url', process.env.CDK_VERIFY_URL || app.node.tryGetContext('verify_url'));
app.node.setContext('a_record_ips', aRecordIps);
app.node.setContext('force_dns_success', process.env.CDK_FORCE_DNS_SUCCESS || app.node.tryGetContext('force_dns_success') || 'false');
app.node.setContext('dns_servers', dnsServers);

// Create the stack with environment variables
new LambdaApiStack(app, `LambdaApiStack-${environment}`, {
  env: { 
    region: process.env.CDK_REGION || app.node.tryGetContext('region') || 'us-east-1'
  },
  // Stack properties
  stackName: `lambda-api-${environment}`,
  description: `Lambda API for custom domain (${environment})`
});
