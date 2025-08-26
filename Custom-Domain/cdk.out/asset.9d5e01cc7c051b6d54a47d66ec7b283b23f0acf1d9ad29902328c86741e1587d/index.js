const AWS = require('aws-sdk');

const elbv2 = new AWS.ELBv2();

exports.handler = async (event) => {
  try {
    // Load ARNs from environment variables
    const listenerArn = process.env.LISTENER_ARN;
    const targetGroupArn = process.env.TARGET_GROUP_ARN;

    if (!listenerArn || !targetGroupArn) {
      throw new Error('Missing required ARNs in environment variables');
    }

    const body = JSON.parse(event.body);
    const { headerValue } = body;

    if (!headerValue) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Missing required parameters: headerValue' }),
      };
    }

    // Fetch existing rules to calculate the next priority dynamically
    const rules = await elbv2.describeRules({ ListenerArn: listenerArn }).promise();
    const priorities = rules.Rules.map(rule => parseInt(rule.Priority, 10)).filter(Number.isFinite);
    const nextPriority = Math.max(...priorities, 0) + 1;

    const params = {
      Actions: [
        {
          Type: 'forward',
          TargetGroupArn: targetGroupArn,
        },
      ],
      Conditions: [
        {
          Field: 'host-header',
          Values: [headerValue],
        },
      ],
      ListenerArn: listenerArn,
      Priority: nextPriority,
    };

    const result = await elbv2.createRule(params).promise();

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Rule created successfully',
        ruleArn: result.Rules[0].RuleArn,
      }),
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Error creating rule', error: error.message }),
    };
  }
};
