import * as awsx from '@pulumi/awsx'

interface VpcInputs {
  deploymentName: string
  cidrBlock: string
}
/**
 * Create a VPC for our cluster.
 * tags used by autoscaler
 */
const createVpc = ({ deploymentName, cidrBlock }: VpcInputs): awsx.ec2.Vpc => {
  const vpc = new awsx.ec2.Vpc('vpc', {
    numberOfAvailabilityZones: 2,
    cidrBlock,
    enableDnsHostnames: true,
    subnets: [
      {
        type: 'public',
        tags: {
          [`kubernetes.io/cluster/${deploymentName}`]: 'shared',
          'kubernetes.io/role/elb': '1'
        }
      },
      {
        type: 'private',
        tags: {
          [`kubernetes.io/cluster/${deploymentName}`]: 'shared',
          'kubernetes.io/role/elb': '1'
        }
      }
    ]
  })
  return vpc
}

export default createVpc