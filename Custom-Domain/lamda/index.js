const AWS = require('aws-sdk');
const elbv2 = new AWS.ELBv2();
const acm = new AWS.ACM();
const axios = require('axios');

// Helper function to wait for a condition with exponential backoff
const waitForCondition = async (condition, maxAttempts = 10, initialDelay = 1000) => {
  let attempts = 0;
  while (attempts < maxAttempts) {
    if (await condition()) {
      return true;
    }
    attempts++;
    await new Promise(resolve => setTimeout(resolve, initialDelay * Math.pow(2, attempts)));
  }
  throw new Error('Condition not met after maximum attempts');
};

exports.handler = async (event) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*', // Replace with your specific origin in production
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
    'Access-Control-Allow-Methods': 'OPTIONS,POST,GET,DELETE'
  };

  // Handle preflight request
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: headers,
      body: ''
    };
  }

  try {
    const listenerArn = process.env.LISTENER_ARN;
    const targetGroupArn = process.env.TARGET_GROUP_ARN;
    const verifyurl = process.env.VERIFY_URL;

    if (!listenerArn || !targetGroupArn) {
      throw new Error('Missing required ARNs in environment variables');
    }

    const body = JSON.parse(event.body);
    const { headerValue, action } = body;

    if (!headerValue || !action) {
      return {
        statusCode: 400,
        headers: headers,
        body: JSON.stringify({ message: 'Missing required parameters: headerValue or action' }),
      };
    }

    if (action === 'request') {
      // Check if a certificate already exists for the domain
      const certificates = await acm.listCertificates().promise();
      const existingCertificate = certificates.CertificateSummaryList.find(cert => cert.DomainName === headerValue);

      if (existingCertificate) {
        const certDetails = await acm.describeCertificate({ CertificateArn: existingCertificate.CertificateArn }).promise();
        const status = certDetails.Certificate.Status;

        if (status === 'PENDING_VALIDATION') {
          const validationOption = certDetails.Certificate.DomainValidationOptions[0];
          const validationRecord = validationOption.ResourceRecord;
          const trimmedName = validationRecord.Name.replace(headerValue + '.', '').replace(/\.$/, '');

          return {
            statusCode: 200,
            headers: headers,
            body: JSON.stringify({
              message: 'Certificate already exists and is pending validation',
              certificateArn: existingCertificate.CertificateArn,
              status: status,
              acmValidation: {
                name: trimmedName,
                type: validationRecord.Type,
                value: validationRecord.Value
              },
              acmValidationInstruction: `Please create a ${validationRecord.Type} record with name ${trimmedName} and value ${validationRecord.Value} in your DNS provider to validate the ACM certificate.`
            }),
          };
        } else {
          return {
            statusCode: 200,
            headers: headers,
            body: JSON.stringify({
              message: 'Certificate already exists',
              certificateArn: existingCertificate.CertificateArn,
              status: status,
              acmValidationInstruction: status === 'PENDING_VALIDATION' ? 'Certificate validation is still pending. Please check back later.' : ''
            }),
          };
        }
      }

      // Request a new ACM certificate
      const certificateParams = {
        DomainName: headerValue,
        SubjectAlternativeNames: [`*.${headerValue}`], 
        ValidationMethod: 'DNS'
      };
      const certificate = await acm.requestCertificate(certificateParams).promise();
      const certificateArn = certificate.CertificateArn;

      // Wait for the certificate details to be available
      await waitForCondition(async () => {
        const certDetails = await acm.describeCertificate({ CertificateArn: certificateArn }).promise();
        return certDetails.Certificate.DomainValidationOptions[0].ResourceRecord !== undefined;
      });

      // Fetch the certificate details to get the DNS validation records
      const certDetails = await acm.describeCertificate({ CertificateArn: certificateArn }).promise();
      const validationOption = certDetails.Certificate.DomainValidationOptions[0];
      const validationRecord = validationOption.ResourceRecord;
      const trimmedName = validationRecord.Name.replace(headerValue + '.', '').replace(/\.$/, '');

      return {
        statusCode: 200,
        headers: headers,
        body: JSON.stringify({
          message: 'Certificate requested successfully',
          certificateArn,
          acmValidation: {
            name: trimmedName,
            type: validationRecord.Type,
            value: validationRecord.Value
          },
          acmValidationInstruction: `Please create a ${validationRecord.Type} record with name ${trimmedName} and value ${validationRecord.Value} in your DNS provider to validate the ACM certificate.`
        }),
      };
    } else if (action === 'check') {
      try {
        // Fetch existing rules
        const rules = await elbv2.describeRules({ ListenerArn: listenerArn }).promise();

        // Check if a rule with the same headerValue already exists
        const existingRule = rules.Rules.find(rule =>
          rule.Conditions.some(condition =>
            condition.Field === 'host-header' && condition.Values.includes(headerValue)
          )
        );

        let ruleArn;
        let message;

        if (existingRule) {
          ruleArn = existingRule.RuleArn;
          message = 'Rule already exists';
        } else {
          // Calculate the next priority
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
                 Values: [headerValue, `www.${headerValue}`],
              },
            ],
            ListenerArn: listenerArn,
            Priority: nextPriority,
          };

          const result = await elbv2.createRule(params).promise();
          ruleArn = result.Rules[0].RuleArn;
          message = 'Rule created successfully';
        }

        // Get the Load Balancer ARN from the Listener
        const listener = await elbv2.describeListeners({ ListenerArns: [listenerArn] }).promise();
        const loadBalancerArn = listener.Listeners[0].LoadBalancerArn;

        // Get the Load Balancer details to fetch the DNS name
        const loadBalancer = await elbv2.describeLoadBalancers({ LoadBalancerArns: [loadBalancerArn] }).promise();
        const dnsName = loadBalancer.LoadBalancers[0].DNSName;

        // List certificates and find the one for the given domain
        const certificates = await acm.listCertificates().promise();
        const certificate = certificates.CertificateSummaryList.find(cert => cert.DomainName === headerValue);

        if (!certificate) {
          return {
            statusCode: 404,
            headers: headers,
            body: JSON.stringify({ message: 'Certificate not found for the given domain' }),
          };
        }

        // Check if the certificate is issued
        const certDetails = await acm.describeCertificate({ CertificateArn: certificate.CertificateArn }).promise();
        if (certDetails.Certificate.Status === 'ISSUED') {
          // Assign the SNI certificate to the load balancer
          await elbv2.addListenerCertificates({
            ListenerArn: listenerArn,
            Certificates: [{ CertificateArn: certificate.CertificateArn }]
          }).promise();

          // Verify the certificate status using an external API
          const verifyResponse = await axios.post(verifyurl, {
            headerValue: headerValue
          });

          if (verifyResponse.data.message === 'matched') {
            return {
              statusCode: 200,
              headers: headers,
              body: JSON.stringify({
                message: 'Domain is already pointed to the landing page.',
              }),
            };
          } else {
            const aRecordIps = JSON.parse(process.env.A_RECORD_IPS || '[]');
            return {
              statusCode: 200,
              headers: headers,
              body: JSON.stringify({
                message: 'Please check the below steps.',
                ruleArn,
                dnsName,
                certificateArn: certificate.CertificateArn,
                dnsInstruction: `Please create A records for ${headerValue} pointing to the following IPs: ${aRecordIps.join(', ')}`,
                ip1: aRecordIps.length > 0 ? [aRecordIps[0]] : [], // First IP as an array, if available
                ip2: aRecordIps.length > 1 ? [aRecordIps[1]] : [] // Second IP as an array, if available
              }),
            };
          }
        } else {
          return {
            statusCode: 202,
            headers: headers,
            body: JSON.stringify({
              message: 'The certificate has not been issued yet. Please wait a few minutes and then click "Continue" to proceed to the next step..',
              status: certDetails.Certificate.Status
            }),
          };
        }
      } catch (error) {
        console.error('Error during check action:', error);
        return {
          statusCode: 500,
          headers: headers,
          body: JSON.stringify({ message: 'Error processing check request', error: error.message }),
        };
      }
    } if (action === 'delete') {
      try {
        console.log(`Attempting to delete certificate for domain: ${headerValue}`);
        
        // List certificates and find the one for the given domain
        const certificates = await acm.listCertificates().promise();
        const certificateToDelete = certificates.CertificateSummaryList.find(cert => cert.DomainName === headerValue);
    
        if (!certificateToDelete) {
          console.log(`Certificate not found for domain: ${headerValue}`);
          return {
            statusCode: 404,
            headers: headers,
            body: JSON.stringify({ message: 'Certificate not found for the given domain' }),
          };
        }
    
        console.log(`Found certificate to delete: ${certificateToDelete.CertificateArn}`);
    
        // Fetch the listener details
        const listenerDetails = await elbv2.describeListeners({ ListenerArns: [listenerArn] }).promise();
        const listener = listenerDetails.Listeners[0];
    
        if (!listener) {
          throw new Error(`Listener not found for ARN: ${listenerArn}`);
        }
    
        console.log(`Removing certificate from listener: ${listenerArn}`);
        try {
          await elbv2.removeListenerCertificates({
            ListenerArn: listenerArn,
            Certificates: [{ CertificateArn: certificateToDelete.CertificateArn }]
          }).promise();
        } catch (error) {
          if (error.code !== 'CertificateNotFound') {
            throw error;
          }
        }
    
        // Remove any rules associated with this domain
        const rules = await elbv2.describeRules({ ListenerArn: listenerArn }).promise();
        for (const rule of rules.Rules) {
          if (rule.Conditions.some(condition => 
            condition.Field === 'host-header' && condition.Values.includes(headerValue)
          )) {
            console.log(`Deleting rule: ${rule.RuleArn}`);
            await elbv2.deleteRule({ RuleArn: rule.RuleArn }).promise();
          }
        }
    
        // Define the checkCertificateStatus function
        const checkCertificateStatus = async () => {
          const certDetails = await acm.describeCertificate({ CertificateArn: certificateToDelete.CertificateArn }).promise();
          const inUseByResources = certDetails.Certificate.InUseBy || [];
          return { inUse: inUseByResources.length > 0 };
        };
  
        // Wait for a short period to ensure all disassociations are processed
        const waitForDisassociation = async (maxAttempts = 10) => {
          for (let i = 0; i < maxAttempts; i++) {
            const status = await checkCertificateStatus();
            if (!status.inUse) return;
            await new Promise(resolve => setTimeout(resolve, 3000));
          }
          throw new Error('Timeout waiting for certificate disassociation');
        };
        await waitForDisassociation();
    
        // Attempt to delete the certificate
        console.log(`Deleting certificate: ${certificateToDelete.CertificateArn}`);
        await acm.deleteCertificate({ CertificateArn: certificateToDelete.CertificateArn }).promise();
    
        return {
          statusCode: 200,
          headers: headers,
          body: JSON.stringify({
            message: 'Certificate and associated rules deleted successfully.',
            deletedCertificateArn: certificateToDelete.CertificateArn
          }),
        };
      } catch (error) {
        console.error('Error during delete action:', JSON.stringify(error, null, 2));
        let errorMessage = 'Error processing delete request';
        let statusCode = 500;
    
        switch(error.code) {
          case 'ResourceInUseException':
            errorMessage = 'Certificate is still in use. Please check all services and try again.';
            statusCode = 400;
            break;
          case 'ResourceNotFoundException':
            errorMessage = 'Certificate not found. It may have been already deleted.';
            statusCode = 404;
            break;
          default:
            console.error('Unexpected error:', error);
        }
    
        return {
          statusCode: statusCode,
          headers: headers,
          body: JSON.stringify({ 
            message: errorMessage, 
            error: error.message,
            stackTrace: error.stack 
          }),
        };
      }
    } else {
      return {
        statusCode: 400,
        headers: headers,
        body: JSON.stringify({ message: 'Invalid action specified' }),
      };
    }
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers: headers,
      body: JSON.stringify({ message: 'Error processing request', error: error.message }),
    };
  }
};