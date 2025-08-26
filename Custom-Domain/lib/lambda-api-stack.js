"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LambdaApiStack = void 0;
const cdk = require("aws-cdk-lib");
const lambda = require("aws-cdk-lib/aws-lambda");
const apigateway = require("aws-cdk-lib/aws-apigateway");
class LambdaApiStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // Define the Lambda function
        const lambdaFunction = new lambda.Function(this, 'LambdaFunction', {
            runtime: lambda.Runtime.NODEJS_16_X,
            code: lambda.Code.fromAsset('../lamda'), // Path to your Lambda code
            handler: 'index.handler',
            environment: {
                LISTENER_ARN: process.env.LISTENER_ARN || '',
                TARGET_GROUP_ARN: process.env.TARGET_GROUP_ARN || ''
            }
        });
        // Define the API Gateway
        const api = new apigateway.RestApi(this, 'LambdaApi', {
            restApiName: 'Lambda API',
            description: 'API Gateway for the Lambda function',
        });
        // Integrate the Lambda function with the API Gateway
        const lambdaIntegration = new apigateway.LambdaIntegration(lambdaFunction);
        api.root.addMethod('GET', lambdaIntegration);
    }
}
exports.LambdaApiStack = LambdaApiStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGFtYmRhLWFwaS1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImxhbWJkYS1hcGktc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsbUNBQW1DO0FBRW5DLGlEQUFpRDtBQUNqRCx5REFBeUQ7QUFFekQsTUFBYSxjQUFlLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDM0MsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFzQjtRQUM5RCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4Qiw2QkFBNkI7UUFDN0IsTUFBTSxjQUFjLEdBQUcsSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxnQkFBZ0IsRUFBRTtZQUNqRSxPQUFPLEVBQUUsTUFBTSxDQUFDLE9BQU8sQ0FBQyxXQUFXO1lBQ25DLElBQUksRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxVQUFVLENBQUMsRUFBRSwyQkFBMkI7WUFDcEUsT0FBTyxFQUFFLGVBQWU7WUFDeEIsV0FBVyxFQUFFO2dCQUNYLFlBQVksRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFlBQVksSUFBSSxFQUFFO2dCQUM1QyxnQkFBZ0IsRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLGdCQUFnQixJQUFJLEVBQUU7YUFDckQ7U0FDRixDQUFDLENBQUM7UUFFSCx5QkFBeUI7UUFDekIsTUFBTSxHQUFHLEdBQUcsSUFBSSxVQUFVLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxXQUFXLEVBQUU7WUFDcEQsV0FBVyxFQUFFLFlBQVk7WUFDekIsV0FBVyxFQUFFLHFDQUFxQztTQUNuRCxDQUFDLENBQUM7UUFFSCxxREFBcUQ7UUFDckQsTUFBTSxpQkFBaUIsR0FBRyxJQUFJLFVBQVUsQ0FBQyxpQkFBaUIsQ0FBQyxjQUFjLENBQUMsQ0FBQztRQUMzRSxHQUFHLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLEVBQUUsaUJBQWlCLENBQUMsQ0FBQztJQUMvQyxDQUFDO0NBQ0Y7QUF6QkQsd0NBeUJDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnOyAvLyBJbXBvcnQgQ29uc3RydWN0IGZyb20gdGhlICdjb25zdHJ1Y3RzJyBwYWNrYWdlXG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XG5pbXBvcnQgKiBhcyBhcGlnYXRld2F5IGZyb20gJ2F3cy1jZGstbGliL2F3cy1hcGlnYXRld2F5JztcblxuZXhwb3J0IGNsYXNzIExhbWJkYUFwaVN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBjZGsuU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgLy8gRGVmaW5lIHRoZSBMYW1iZGEgZnVuY3Rpb25cbiAgICBjb25zdCBsYW1iZGFGdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ0xhbWJkYUZ1bmN0aW9uJywge1xuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE2X1gsXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJy4uL2xhbWRhJyksIC8vIFBhdGggdG8geW91ciBMYW1iZGEgY29kZVxuICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgTElTVEVORVJfQVJOOiBwcm9jZXNzLmVudi5MSVNURU5FUl9BUk4gfHwgJycsXG4gICAgICAgIFRBUkdFVF9HUk9VUF9BUk46IHByb2Nlc3MuZW52LlRBUkdFVF9HUk9VUF9BUk4gfHwgJydcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIERlZmluZSB0aGUgQVBJIEdhdGV3YXlcbiAgICBjb25zdCBhcGkgPSBuZXcgYXBpZ2F0ZXdheS5SZXN0QXBpKHRoaXMsICdMYW1iZGFBcGknLCB7XG4gICAgICByZXN0QXBpTmFtZTogJ0xhbWJkYSBBUEknLFxuICAgICAgZGVzY3JpcHRpb246ICdBUEkgR2F0ZXdheSBmb3IgdGhlIExhbWJkYSBmdW5jdGlvbicsXG4gICAgfSk7XG5cbiAgICAvLyBJbnRlZ3JhdGUgdGhlIExhbWJkYSBmdW5jdGlvbiB3aXRoIHRoZSBBUEkgR2F0ZXdheVxuICAgIGNvbnN0IGxhbWJkYUludGVncmF0aW9uID0gbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24obGFtYmRhRnVuY3Rpb24pO1xuICAgIGFwaS5yb290LmFkZE1ldGhvZCgnR0VUJywgbGFtYmRhSW50ZWdyYXRpb24pO1xuICB9XG59XG4iXX0=