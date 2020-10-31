import * as pulumi from '@pulumi/pulumi'
import * as aws from '@pulumi/aws'
import * as eks from '@pulumi/eks'
import * as k8s from '@pulumi/kubernetes'
import { autoscalerIAMPolicy } from './autoscaler-policy'

interface AutoscalingNodeGroupInput {
  cluster: eks.Cluster
  role: aws.iam.Role
  deploymentName: string
}


/**
 * 
 * Creates an EKS managed node group with autoscaling
 * Autoscaling requires an IAM role being attached to the service account of the autoscaler
 * 
 */
export const createAutoscalingNodeGroup = (inputs: AutoscalingNodeGroupInput): void => {
  const { cluster, role, deploymentName } = inputs
  const clusterOidcProvider = cluster.core.oidcProvider
  const clusterOidcProviderUrl = clusterOidcProvider?.url
  const autoscalerNamespace = new k8s.core.v1.Namespace(
    'cluster-autoscaler',
    { metadata: { name: 'cluster-autoscaler' } },
    { provider: cluster.provider }
  )

  const autoscalerAssumeRolePolicy = pulumi
    .all([clusterOidcProviderUrl, clusterOidcProvider?.arn])
    .apply(([url, arn]) =>
      aws.iam.getPolicyDocument({
        statements: [
          {
            actions: ['sts:AssumeRoleWithWebIdentity'],
            conditions: [
              {
                test: 'StringEquals',
                values: [
                  `system:serviceaccount:cluster-autoscaler:cluster-autoscaler`
                ],
                variable: `${url.replace('https://', '')}:sub`
              }
            ],
            effect: 'Allow',
            principals: [
              {
                identifiers: [arn],
                type: 'Federated'
              }
            ]
          }
        ]
      })
    )

  const autoscalerRole = new aws.iam.Role('cluster-autoscaler', {
    assumeRolePolicy: autoscalerAssumeRolePolicy.json
  })
  const autoscalerPolicy = new aws.iam.Policy(
    'autoscaler-iam-policy',
    {
      policy: autoscalerIAMPolicy
    }
  )
  new aws.iam.RolePolicyAttachment('autoscaler-role-attach-policy', {
    policyArn: autoscalerPolicy.arn,
    role: autoscalerRole.name
  })

  const managedNodeGroup = eks.createManagedNodeGroup(
    'rpa-ng',
    {
      cluster: cluster,
      instanceTypes: 'r5.2xlarge',
      nodeGroupName: 'aws-managed-ng1',
      nodeRoleArn: role.arn,
      labels: { ondemand: 'true', Environment: 'development' },
      scalingConfig: {
        minSize: 1,
        desiredSize: 2,
        maxSize: 10
      }
    },
    cluster
  )






  const autoscalerNamespaceName = autoscalerNamespace.metadata.apply(
    (m: { name: string }) => m.name
  )
  /**
   * Deploy cluster-autoscaler-chart to manage scaling the nodegroup
   */
  const autoscaler = new k8s.helm.v3.Chart(
    'autoscaler',
    {
      namespace: autoscalerNamespaceName,
      chart: 'cluster-autoscaler-chart',
      fetchOpts: {
        repo: 'https://kubernetes.github.io/autoscaler'
      },
      version: '1.0.3',
      values: {
        cloudProvider: 'aws',
        rbac: {
          create: true,
          serviceAccount: {
            create: true,
            name: 'cluster-autoscaler',
            annotations: {
              'eks.amazonaws.com/role-arn': autoscalerRole.arn
            }
          }
        },
        awsRegion: 'us-east-1',
        autoDiscovery: {
          enabled: true,
          clusterName: deploymentName
        }
      }
    },
    { provider: cluster.provider }
  )

}