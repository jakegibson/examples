import * as aws from '@pulumi/aws'
import * as awsx from '@pulumi/awsx'
import * as eks from '@pulumi/eks'


interface ClusterInputs {
  deploymentName: string,
  vpc: awsx.ec2.Vpc
}

interface ClusterOutputs {
  cluster: eks.Cluster,
  role: aws.iam.Role,
  sg: awsx.ec2.SecurityGroup
}

/**
 * 
 * Creates an aws EKS cluster with nodegroup
 */
export const createCluster = (inputs: ClusterInputs): ClusterOutputs => {
  const { deploymentName, vpc } = inputs
  // IAM roles for the node group.
  const role = new aws.iam.Role('cluster-ng-role', {
    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
      Service: 'ec2.amazonaws.com'
    })
  })
  let counter = 0
  for (const policyArn of [
    'arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy',
    'arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy',
    'arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly'
  ]) {
    new aws.iam.RolePolicyAttachment(`my-cluster-ng-role-policy-${counter++}`, {
      policyArn,
      role
    })
  }

  const sg = new awsx.ec2.SecurityGroup('default-eks-sg', {
    vpc,
    // 1) Open ingress traffic to your load balancer. Explicitly needed for NLB, but not ALB:
    // ingress: [{ protocol: "tcp", fromPort: 80, toPort: 80, cidrBlocks: [ "0.0.0.0/0" ] }],
    // 2) Open egress traffic from your EC2 instance to your load balancer (for health checks).
    egress: [
      { protocol: 'TCP', fromPort: 0, toPort: 65535, cidrBlocks: ['0.0.0.0/0'] },
      { protocol: 'UDP', fromPort: 0, toPort: 65535, cidrBlocks: ['0.0.0.0/0'] }
    ]
  })

  // Create the EKS cluster itself and a deployment of the Kubernetes dashboard.
  const cluster = new eks.Cluster(deploymentName, {
    vpcId: vpc.id,
    version: '1.18',
    name: deploymentName,
    publicSubnetIds: vpc.publicSubnetIds,
    privateSubnetIds: vpc.privateSubnetIds,
    instanceType: 't3.medium',
    desiredCapacity: 1,
    minSize: 1,
    maxSize: 10,
    /** creating managed nodegroup separately to use with cluster-autoscaler helm chart */
    skipDefaultNodeGroup: true,
    createOidcProvider: true,
    instanceRoles: [role],
    tags: { Name: deploymentName }
  })

  /** Create HTTP(S) security rules for load balancer */
  awsx.ec2.SecurityGroupRule.ingress(
    'https-access',
    sg,
    new awsx.ec2.AnyIPv4Location(),
    new awsx.ec2.TcpPorts(443),
    'allow https access'
  )
  awsx.ec2.SecurityGroupRule.ingress(
    'http-access',
    sg,
    new awsx.ec2.AnyIPv4Location(),
    new awsx.ec2.TcpPorts(80),
    'allow http access'
  )



  return {
    cluster,
    role,
    sg
  }
}

