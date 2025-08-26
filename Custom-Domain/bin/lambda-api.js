"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cdk = require("aws-cdk-lib");
const lambda_api_stack_1 = require("../lib/lambda-api-stack");
const app = new cdk.App();
new lambda_api_stack_1.LambdaApiStack(app, 'LambdaApiStack', {
    env: {
        region: 'us-east-1', // Replace with your desired region
    },
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGFtYmRhLWFwaS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImxhbWJkYS1hcGkudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSxtQ0FBbUM7QUFDbkMsOERBQXlEO0FBRXpELE1BQU0sR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsRUFBRSxDQUFDO0FBQzFCLElBQUksaUNBQWMsQ0FBQyxHQUFHLEVBQUUsZ0JBQWdCLEVBQUU7SUFDeEMsR0FBRyxFQUFFO1FBQ0gsTUFBTSxFQUFFLFdBQVcsRUFBRSxtQ0FBbUM7S0FDekQ7Q0FDRixDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgTGFtYmRhQXBpU3RhY2sgfSBmcm9tICcuLi9saWIvbGFtYmRhLWFwaS1zdGFjayc7XG5cbmNvbnN0IGFwcCA9IG5ldyBjZGsuQXBwKCk7XG5uZXcgTGFtYmRhQXBpU3RhY2soYXBwLCAnTGFtYmRhQXBpU3RhY2snLCB7XG4gIGVudjoge1xuICAgIHJlZ2lvbjogJ3VzLWVhc3QtMScsIC8vIFJlcGxhY2Ugd2l0aCB5b3VyIGRlc2lyZWQgcmVnaW9uXG4gIH0sXG59KTtcbiJdfQ==