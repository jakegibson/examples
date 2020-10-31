import * as aws from '@pulumi/aws'
import * as k8s from '@pulumi/kubernetes'
import { ec2 } from '@pulumi/awsx'
import { Cluster } from '@pulumi/eks'
import { Output } from '@pulumi/pulumi'

interface DeployTraefikInputs {
  cluster: Cluster
  sg: ec2.SecurityGroup,
  certificateArn: Output<string>
}

export const deployTraefik = ({ cluster, sg, certificateArn }: DeployTraefikInputs): k8s.helm.v3.Chart => {
  /**
   * Deploy traefik helm chart
   * Annotations added for aws NLB with SSL
   * 
   */
  const traefik = new k8s.helm.v3.Chart(
    'traefik',
    {
      namespace: 'default',
      chart: 'traefik',
      version: '9.8.2',
      fetchOpts: {
        repo: 'https://helm.traefik.io/traefik'
      },
      values: {
        logs: {
          general: {
            level: 'INFO'
          },
          access: {
            enabled: true
          }
        },
        service: {
          annotations: {
            'service.beta.kubernetes.io/aws-load-balancer-type': 'nlb',
            'service.beta.kubernetes.io/aws-load-balancer-ssl-cert': certificateArn,
            'service.beta.kubernetes.io/aws-load-balancer-ssl-ports': '*',
            'service.beta.kubernetes.io/aws-load-balancer-proxy-protocol': '*',
            'service.beta.kubernetes.io/aws-load-balancer-backend-protocol':
              'http'
          },
          spec: {
            externalTrafficPolicy: 'Local'
          }
        }
      }
    },
    { provider: cluster.provider }
  )

  /* open 32010 on cluster to lb target groups so lb can get traefik NodePort */

  new aws.ec2.SecurityGroupRule('Traefik', {
    securityGroupId: cluster.eksCluster.vpcConfig.clusterSecurityGroupId.apply(
      (securityGroupId) => securityGroupId
    ),
    sourceSecurityGroupId: sg.id,
    fromPort: 32010,
    toPort: 32010,
    type: 'ingress',
    protocol: 'TCP'
  }, { dependsOn: [cluster, sg] })

  /**
   * Deploy Traefik middlewares
   */
  new k8s.yaml.ConfigGroup(
    'traefik-middlewares',
    {
      files: [
        'strip-prefix-path.yaml',
      ]
    },
    { provider: cluster.provider }
  )


  return traefik
}

