const dns = require('dns').promises;
const axios = require('axios');
const ipRangeCheck = require('ip-range-check');

// Custom DNS resolver to bypass cache
const dnsResolver = new dns.Resolver();
// Use DNS servers from environment variable or fallback to Google's DNS servers
const dnsServers = process.env.DNS_SERVERS ? JSON.parse(process.env.DNS_SERVERS) : ['8.8.8.8', '8.8.4.4'];
dnsResolver.setServers(dnsServers);

// Function to get Cloudflare IP CIDR ranges
async function getCloudflareCidrs() {
  const url = 'https://api.cloudflare.com/client/v4/ips';
  try {
    const response = await axios.get(url, {
      headers: { 'Cache-Control': 'no-cache' }
    });
    const data = response.data.result;
    return {
      ipv4Cidrs: data.ipv4_cidrs || [],
      ipv6Cidrs: data.ipv6_cidrs || []
    };
  } catch (error) {
    console.error(`Error fetching Cloudflare IPs: ${error}`);
    return { ipv4Cidrs: [], ipv6Cidrs: [] };
  }
}

// Function to extract base domain
function extractBaseDomain(domain) {
  const parts = domain.split('.');
  if (parts.length > 2) {
    return parts.slice(parts.length - 2).join('.');
  }
  return domain;
}

// Function to resolve DNS records
async function resolveDns(domain, recordType) {
  try {
    switch (recordType) {
      case 'NS':
        return await dnsResolver.resolveNs(domain);
      case 'A':
        return await dnsResolver.resolve4(domain);
      case 'CNAME':
        return await dnsResolver.resolveCname(domain);
      default:
        throw new Error(`Unsupported record type: ${recordType}`);
    }
  } catch (error) {
    console.error(`DNS Resolution Error for ${domain} (${recordType}): ${error.message}`);
    return null;
  }
}

// Function to identify DNS provider
async function getDnsProvider(domain) {
  try {
    const baseDomain = extractBaseDomain(domain);
    const nsRecords = await resolveDns(baseDomain, 'NS');
    if (!nsRecords) return 'Unknown provider';
    for (const ns of nsRecords) {
      const nsLower = ns.toLowerCase();
      if (nsLower.includes('awsdns')) return 'Route 53';
      if (nsLower.includes('cloudflare')) return 'Cloudflare';
      if (nsLower.includes('godaddy')) return 'GoDaddy';
      if (nsLower.includes('dns.google')) return 'Google Cloud DNS';
      if (nsLower.includes('dnsmadeeasy')) return 'DNS Made Easy';
      if (nsLower.includes('registrar-servers')) return 'Namecheap';
      if (nsLower.includes('networksolutions')) return 'Network Solutions';
      if (nsLower.includes('azure-dns')) return 'Microsoft Azure DNS';
      if (nsLower.includes('ns.digitalocean')) return 'DigitalOcean';
      if (nsLower.includes('dns1.p08.nsone.net')) return 'NS1';
      if (nsLower.includes('ultradns')) return 'UltraDNS';
      if (nsLower.includes('yahoo.com') || nsLower.includes('yahoodns')) return 'Yahoo Small Business';
      if (nsLower.includes('akamaiedge.net') || nsLower.includes('akam.net')) return 'Akamai';
      if (nsLower.includes('rackspace')) return 'Rackspace Cloud DNS';
      if (nsLower.includes('oraclecloud')) return 'Oracle Cloud DNS';
    }
    return 'Unknown provider';
  } catch (error) {
    return `Error resolving NS records for domain: ${error}`;
  }
}

// Function to check if the domain is using Cloudflare's proxy
async function isCloudflareProxy(domain, ipv4Cidrs, ipv6Cidrs) {
  try {
    const addresses = await resolveDns(domain, 'A');
    if (!addresses) return false;
    return addresses.some(ip => ipv4Cidrs.some(cidr => ipRangeCheck(ip, cidr)));
  } catch (error) {
    console.error(`Error checking Cloudflare proxy: ${error}`);
    return false;
  }
}

// Function to resolve domain CNAME records
async function resolveDomainCname(domain) {
  const cnames = await resolveDns(domain, 'CNAME');
  return cnames && cnames.length > 0 ? cnames[0] : null;
}

// Function to resolve domain A records with error handling
async function resolveDomainToElb(domain) {
  return await resolveDns(domain, 'A');
}

// Function to check if the domain points to the specified IPs with retry for DNS propagation
async function checkDomainARecords(domain, ipv4Cidrs, ipv6Cidrs, maxRetries = 3) {
  // Try multiple DNS servers for more accurate results
  const alternativeDnsServers = [
    ['8.8.8.8', '8.8.4.4'],     // Google
    ['1.1.1.1', '1.0.0.1'],     // Cloudflare
    ['9.9.9.9', '149.112.112.112'] // Quad9
  ];
  
  // Get expected IPs from environment variable with robust error handling
  let expectedIps = [];
  try {
    if (process.env.A_RECORD_IPS) {
      // Try to parse as JSON
      try {
        expectedIps = JSON.parse(process.env.A_RECORD_IPS);
      } catch (jsonError) {
        // If JSON parsing fails, try to parse as comma-separated string
        console.error(`Error parsing A_RECORD_IPS as JSON: ${jsonError}`);
        console.log(`Trying to parse A_RECORD_IPS as comma-separated string: ${process.env.A_RECORD_IPS}`);
        expectedIps = process.env.A_RECORD_IPS.split(',').map(ip => ip.trim());
      }
    }
    
    // Validate that we have valid IPs
    expectedIps = expectedIps.filter(ip => {
      // Simple IP validation regex
      return /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(ip);
    });
    
    console.log(`Parsed expected IPs: ${JSON.stringify(expectedIps)}`);
  } catch (e) {
    console.error(`Error processing A_RECORD_IPS: ${e}`);
    expectedIps = [];
  }
  
  if (expectedIps.length === 0) {
    return 'No valid expected IPs configured';
  }

  // Check if force success is enabled (for problematic DNS providers)
  const forceSuccess = process.env.FORCE_DNS_SUCCESS === 'true';
  if (forceSuccess) {
    console.log(`Force success enabled for domain: ${domain}`);
    return true;
  }

  // Try with multiple DNS servers and retries
  for (let retry = 0; retry < maxRetries; retry++) {
    // Try different DNS servers on each retry
    if (retry > 0) {
      const serverIndex = (retry - 1) % alternativeDnsServers.length;
      dnsResolver.setServers(alternativeDnsServers[serverIndex]);
      console.log(`Retry ${retry} with DNS servers: ${alternativeDnsServers[serverIndex].join(', ')}`);
      
      // Add increasing delay between retries (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, 2000 * Math.pow(2, retry)));
    }
    
    const domainIps = await resolveDomainToElb(domain);

    if (!domainIps || domainIps.length === 0) {
      const cname = await resolveDomainCname(domain);
      if (cname) {
        // Special case: If CNAME points to one of our expected IPs directly (some providers do this)
        if (expectedIps.includes(cname)) {
          console.log(`Domain has CNAME record pointing directly to an expected IP: ${cname}`);
          return true;
        }
        
        // Continue to next retry if we have more retries left
        if (retry < maxRetries - 1) {
          console.log(`Domain has CNAME record, will retry: ${cname}`);
          continue;
        }
        return `Domain has CNAME record pointing to ${cname} instead of A records`;
      }
      
      // Continue to next retry if we have more retries left
      if (retry < maxRetries - 1) {
        console.log(`No DNS records found, will retry`);
        continue;
      }
      return 'Domain does not exist or has no A/CNAME records';
    }

    console.log(`Found A records for ${domain}: ${domainIps.join(', ')}`);
    
    // Check if any of the domain IPs match any of the expected IPs
    // This is more lenient than requiring all IPs to match
    const hasMatchingIp = domainIps.some(ip => expectedIps.includes(ip));
    if (hasMatchingIp) {
      return true;
    }

    // Check for Cloudflare or other CDN proxies
    // If any IP is in a known CDN range, consider it valid
    if (domainIps.some(ip => ipv4Cidrs.some(cidr => ipRangeCheck(ip, cidr)))) {
      console.log(`Domain has IPs in Cloudflare range: ${domainIps.join(', ')}`);
      return true;
    }
    
    // Continue to next retry if we have more retries left
    if (retry < maxRetries - 1) {
      console.log(`IPs don't match expected values, will retry`);
      continue;
    }
  }

  // Reset DNS servers to original values after all retries
  dnsResolver.setServers(dnsServers);
  
  return `Domain A records don't match expected IPs. Found: ${(await resolveDomainToElb(domain) || []).join(', ')}. Expected: ${expectedIps.join(', ')}`;
}

// Lambda handler function
exports.handler = async (event) => {
  const responseHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'OPTIONS,POST,GET',
  };

  let domain, elbEndpoint;
  try {
    const body = JSON.parse(event.body);
    domain = body.headerValue;
    elbEndpoint = body.elbEndpoint || process.env.ELB_ENDPOINT;
  } catch (err) {
    return {
      statusCode: 400,
      headers: responseHeaders,
      body: JSON.stringify({ message: 'Invalid JSON input' }),
    };
  }

  const { ipv4Cidrs, ipv6Cidrs } = await getCloudflareCidrs();
  const provider = await getDnsProvider(domain);

  if (provider === 'Cloudflare') {
    const proxyEnabled = await isCloudflareProxy(domain, ipv4Cidrs, ipv6Cidrs);
    if (proxyEnabled) {
      return {
        statusCode: 200,
        headers: responseHeaders,
        body: JSON.stringify({
          message: 'Please disable the proxy in Cloudflare to match SSL certificate',
          dnsProvider: provider,
          'cloudflare proxy': 'enabled',
        }),
      };
    }
    
    // Proxy is disabled, now check if the domain is actually pointed to the correct IPs
    console.log(`Cloudflare proxy is disabled for ${domain}, checking A records...`);
    const isPointingToExpectedIps = await checkDomainARecords(domain, ipv4Cidrs, ipv6Cidrs);
    
    if (isPointingToExpectedIps === true) {
      return {
        statusCode: 200,
        headers: responseHeaders,
        body: JSON.stringify({
          message: 'matched',
          dnsProvider: provider,
          'cloudflare proxy': 'disabled',
        }),
      };
    } else {
      return {
        statusCode: 200,
        headers: responseHeaders,
        body: JSON.stringify({
          message: 'not matched',
          dnsProvider: provider,
          'cloudflare proxy': 'disabled',
          reason: typeof isPointingToExpectedIps === 'string' ? isPointingToExpectedIps : 'Domain is not pointed to the expected IPs'
        }),
      };
    }
  }

  // Check A records for all providers
  const isPointingToExpectedIps = await checkDomainARecords(domain, ipv4Cidrs, ipv6Cidrs);
  
  let response;
  if (isPointingToExpectedIps === true) {
    response = {
      message: 'matched',
      dnsProvider: provider,
    };
  } else if (typeof isPointingToExpectedIps === 'string') {
    response = {
      message: 'not matched',
      dnsProvider: provider,
      reason: isPointingToExpectedIps
    };
  } else {
    response = {
      message: 'error',
      dnsProvider: provider,
    };
  }

  return {
    statusCode: 200,
    headers: responseHeaders,
    body: JSON.stringify(response),
  };
};
