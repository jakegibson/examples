import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'
const config = new pulumi.Config()

/**
 * Parse domain to get root domain, and subdomain
 * 
 */
const getDomainAndSubdomain = (domain: string): { subdomain: string, parentDomain: string } => {
  const parts = domain.split('.')
  if (parts.length < 2) {
    throw new Error(`No TLD found on ${domain}`)
  }
  // No subdomain, e.g. atomicfi.com.
  if (parts.length === 2) {
    return { subdomain: '', parentDomain: domain }
  }

  const subdomain = parts[0]
  parts.shift() // Drop first element.
  return {
    subdomain,
    // Trailing "." to canonicalize domain.
    parentDomain: parts.join('.') + '.'
  }
}

const getHostedZoneId = async (domain: string): Promise<string> => {
  const domainParts = getDomainAndSubdomain(domain)
  const hostedZoneId = await aws.route53
    .getZone({ name: domainParts.parentDomain }, { async: true })
    .then((zone) => zone.zoneId)

  return hostedZoneId
}
const eastRegion = new aws.Provider('east', {
  profile: 'atomic-dev',
  region: 'us-east-1' // Per AWS, ACM certificate must be in the us-east-1 region.
})

interface AliasRecordInputs {
  aliasName: string
  domain: string
}
export const createAliasRecord = (inputs: AliasRecordInputs): void => {
  const { aliasName, domain } = inputs
  const hostedZoneId = getHostedZoneId(domain)
  new aws.route53.Record(`${domain}`, {
    name: domain,
    zoneId: hostedZoneId,
    type: 'A',
    aliases: [
      {
        name: aliasName,
        zoneId: config.require('elbHostedZoneID'),
        evaluateTargetHealth: true
      }
    ]
  })

}

export const createCertificate = ({ domain }: { domain: string }): pulumi.Output<string> => {
  const hostedZoneId = getHostedZoneId(domain)
  // create ssl cert for domain
  const tenMinutes = 60 * 10
  const certificate = new aws.acm.Certificate(
    'certificate',
    {
      domainName: domain,
      validationMethod: 'DNS'
    },
    { provider: eastRegion }
  )

  /*
   *  Create a DNS record to prove that we _own_ the domain we're requesting a certificate for.
   *  See https://docs.aws.amazon.com/acm/latest/userguide/gs-acm-validate-dns.html for more info.
   */
  const certificateValidationDomain = new aws.route53.Record(
    `${domain}-validation`,
    {
      name: certificate.domainValidationOptions[0].resourceRecordName,
      zoneId: hostedZoneId,
      type: certificate.domainValidationOptions[0].resourceRecordType,
      records: [certificate.domainValidationOptions[0].resourceRecordValue],
      ttl: tenMinutes
    }
  )

  /**
   * This is a _special_ resource that waits for ACM to complete validation via the DNS record
   * checking for a status of "ISSUED" on the certificate itself. No actual resources are
   * created (or updated or deleted).
   *
   * See https://www.terraform.io/docs/providers/aws/r/acm_certificate_validation.html for slightly more detail
   * and https://github.com/terraform-providers/terraform-provider-aws/blob/master/aws/resource_aws_acm_certificate_validation.go
   * for the actual implementation.
   */
  const certificateValidation = new aws.acm.CertificateValidation(
    'certificateValidation',
    {
      certificateArn: certificate.arn,
      validationRecordFqdns: [certificateValidationDomain.fqdn]
    },
    { provider: eastRegion }
  )

  const certificateArn = certificateValidation.certificateArn
  return certificateArn
}



