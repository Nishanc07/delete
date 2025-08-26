import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';

export class LambdaApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Get values from context
    const listenerArn = this.node.tryGetContext('listener_arn');
    const targetGroupArn = this.node.tryGetContext('target_group_arn');
    const elbEndpoint = this.node.tryGetContext('elb_endpoint');
    const dnsServers = this.node.tryGetContext('dns_servers');

    // Get environment from context
    const environment = this.node.tryGetContext('env') || 'dev';
    
    // Define the first Lambda function
    const lambdaFunctionLanding = new lambda.Function(this, 'LambdaFunctionLanding', {
      functionName: `1851-landing-${environment}`,
      runtime: lambda.Runtime.NODEJS_16_X,
      code: lambda.Code.fromAsset('lamda'), // Ensure correct path
      handler: 'index.handler',
      timeout: cdk.Duration.minutes(14),
      memorySize: 512,
      environment: {
        LISTENER_ARN: listenerArn,
        TARGET_GROUP_ARN: targetGroupArn,
        VERIFY_URL: this.node.tryGetContext('verify_url'),
        A_RECORD_IPS: JSON.stringify(this.node.tryGetContext('a_record_ips')),
      },
    });

    // IAM Policy for Lambda
    lambdaFunctionLanding.addToRolePolicy(new iam.PolicyStatement({
      actions: ['elasticloadbalancing:*', 'acm:*'],
      resources: ['*'], 
    }));

    const lambdaFunctionVerify = new lambda.Function(this, 'LambdaFunctionVerify', {
      functionName: `1851-verify-dns-${environment}`,
      runtime: lambda.Runtime.NODEJS_16_X,
      code: lambda.Code.fromAsset('verify-dns'),
      handler: 'index.handler',
      timeout: cdk.Duration.minutes(14),
      memorySize: 512,
      environment: {
        ELB_ENDPOINT: elbEndpoint,
        DNS_SERVERS: JSON.stringify(dnsServers),
        A_RECORD_IPS: JSON.stringify(this.node.tryGetContext('a_record_ips')),
        FORCE_DNS_SUCCESS: this.node.tryGetContext('force_dns_success') || 'false',
      },
    });

    lambdaFunctionVerify.addToRolePolicy(new iam.PolicyStatement({
      actions: ['elasticloadbalancing:*'],
      resources: ['*'],
    }));

    // API Gateway
    const api = new apigateway.RestApi(this, 'LambdaApi', {
      restApiName: `Lambda API Landing - ${environment}`,
      description: `API Gateway for the Lambda functions (${environment})`,
      deploy: false, // Prevent automatic deployment
    });

    // Check if deployment stage exists before creating it
    if (!api.deploymentStage) {
      const deployment = new apigateway.Deployment(this, `Deployment-${environment}`, { api });
      const stage = new apigateway.Stage(this, `${environment.charAt(0).toUpperCase() + environment.slice(1)}Stage`, {
        deployment,
        stageName: environment,
      });
      api.deploymentStage = stage;
    }

    // CORS Configuration
    const corsOptions = {
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: apigateway.Cors.ALL_METHODS,
      allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key'],
    };

    // Define 'landing-page' resource
    const landingPageResource = api.root.addResource('landing-page');
    landingPageResource.addMethod('ANY', new apigateway.LambdaIntegration(lambdaFunctionLanding), {
      methodResponses: [{ statusCode: '200' }],
    });

    // CORS for OPTIONS
    landingPageResource.addMethod('OPTIONS', new apigateway.MockIntegration({
      integrationResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': "'*'",
          'method.response.header.Access-Control-Allow-Methods': "'OPTIONS,ANY'",
          'method.response.header.Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key'",
        },
      }],
      passthroughBehavior: apigateway.PassthroughBehavior.WHEN_NO_MATCH,
      requestTemplates: { 'application/json': '{"statusCode": 200}' },
    }), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Methods': true,
          'method.response.header.Access-Control-Allow-Headers': true,
        },
      }],
    });

    // Define 'verify' resource nested under 'landing-page'
    const verifyResource = landingPageResource.addResource('verify');
    verifyResource.addMethod('ANY', new apigateway.LambdaIntegration(lambdaFunctionVerify), {
      methodResponses: [{ statusCode: '200' }],
    });

    verifyResource.addMethod('OPTIONS', new apigateway.MockIntegration({
      integrationResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': "'*'",
          'method.response.header.Access-Control-Allow-Methods': "'OPTIONS,ANY'",
          'method.response.header.Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key'",
        },
      }],
      passthroughBehavior: apigateway.PassthroughBehavior.WHEN_NO_MATCH,
      requestTemplates: { 'application/json': '{"statusCode": 200}' },
    }), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Methods': true,
          'method.response.header.Access-Control-Allow-Headers': true,
        },
      }],
    });
  }
}
