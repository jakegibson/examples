import * as pulumi from '@pulumi/pulumi'

import createVpc from './vpc'
import { createCluster } from './eks/create-cluster'
import { deployTraefik } from './traefik/traefik'
import { createAliasRecord, createCertificate } from './aws-domain'
import { createAutoscalingNodeGroup } from './eks/cluster-autoscaling'

const stack = pulumi.getStack()
/** replace with a domain whose root has an existing zone in Route53  */
const domain = 'bob.atmcdev.com'//'replace-me.example.com'
const deploymentName = `my-service-${stack}`
const cidrBlock = '10.90.0.0/16'


/** Create aws VPC */
const vpc = createVpc({ deploymentName, cidrBlock })

/** Create aws EKS cluster with nodegroup */
const { cluster, role, sg } = createCluster({ deploymentName, vpc })

/** Create autoscaling managed nodegroup on EKS cluster */
createAutoscalingNodeGroup({ cluster, deploymentName, role })

/** Create ssl certificate throw aws ACM */
const certificateArn = createCertificate({ domain })

/** Deploy traefik helm chart and middlewares */
const traefik = deployTraefik({ certificateArn, cluster, sg })

/** Create domain name and point it to aws NLB that points to traefik loadbalancer */
const traefikService = traefik.getResource('v1/Service', 'traefik')
traefikService.status.loadBalancer.ingress[0].hostname.apply((hostname: string) => {
  createAliasRecord({ domain, aliasName: hostname })
})


export = {
  clusterVPCSecurityGroupId:
    cluster.eksCluster.vpcConfig.clusterSecurityGroupId,
  clusterId: cluster.eksCluster.id,
  vpcId: vpc.id,
  traefik: traefik.resources['v1/Service::traefik']
}