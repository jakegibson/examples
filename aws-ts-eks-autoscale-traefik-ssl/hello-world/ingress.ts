const service = new k8s.core.v1.Service('hello-node', {
  metadata: {
    name: "example-ingress",
    annotations: {
      "nginx.ingress.kubernetes.io/rewrite-target": "/$1"
    }
  },
  spec: {
    rules: [
      {
        host: "hello-world.info",
        http: {
          paths: [
            {
              path: "/hello",
              pathType: "Prefix",
              backend: {
                service: {
                  name: "hello-node",
                  port: {
                    number: 8080
                  }
                }
              }
            }
          ]
        }
      }
    ]
  },
}, { provider: cluster.provider });

