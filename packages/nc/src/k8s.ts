/* eslint-disable no-console */

import * as k8s from '@kubernetes/client-node'
import chance from 'chance'

const runK8sCommand = async (enabled: boolean, func: () => Promise<unknown>): Promise<void> => {
  try {
    enabled && (await func())
  } catch (error) {
    // console.error(JSON.stringify(error.response.body.message))
    console.error(error)
  }
}

enum K8sConnectionStrategyType {
  tryReadFromLocalMachine = '1',
  specifyConnectionDetails = '2',
}

type TryReadFromLocalMachine = {
  k8sConnectionStrategyType: K8sConnectionStrategyType.tryReadFromLocalMachine
}

type SpecifyConnectionDetails = {
  k8sConnectionStrategyType: K8sConnectionStrategyType.specifyConnectionDetails
  connectionDetails: {
    cluster: {
      name: string
      server: string
      skipTLSVerify: boolean
    } & ({ caData: string } | { caFile: string })
    user:
      | {
          name: string
          authProvider: {
            config: {
              'access-token': string
              'cmd-args': string
              'cmd-path': string
              expiry: string
              'expiry-key': string
              'token-key': string
            }
            name: string
          }
        }
      | {
          certFile: string
          keyFile: string
          name: string
        }
    context: {
      cluster: string
      name: string
      user: string
    }
  }
}

function getK8sClient(options: TryReadFromLocalMachine | SpecifyConnectionDetails): k8s.KubeConfig {
  const kc = new k8s.KubeConfig()
  switch (options.k8sConnectionStrategyType) {
    case K8sConnectionStrategyType.specifyConnectionDetails:
      console.log(options.k8sConnectionStrategyType)
      kc.loadFromOptions({
        clusters: [options.connectionDetails.cluster],
        users: [options.connectionDetails.user],
        contexts: [options.connectionDetails.context],
        currentContext: options.connectionDetails.context.name,
      })
      break
    case K8sConnectionStrategyType.tryReadFromLocalMachine:
      console.log(options.k8sConnectionStrategyType)
      kc.loadFromDefault()
      break
  }
  return kc
}

function getMinikubeClient() {
  return getK8sClient({
    k8sConnectionStrategyType: K8sConnectionStrategyType.specifyConnectionDetails,
    connectionDetails: {
      cluster: {
        caFile: '/Users/stavalfi/.minikube/ca.crt',
        name: 'minikube',
        server: 'https://127.0.0.1:32772',
        skipTLSVerify: false,
      },
      user: {
        certFile: '/Users/stavalfi/.minikube/profiles/minikube/client.crt',
        keyFile: '/Users/stavalfi/.minikube/profiles/minikube/client.key',
        name: 'minikube',
      },
      context: {
        cluster: 'minikube',
        name: 'minikube',
        user: 'minikube',
      },
    },
  })
}

async function main() {
  const kc = getMinikubeClient()

  const apiClient = kc.makeApiClient(k8s.CoreV1Api)

  const gitToken = `37e7707f7a07bea84d55d46c48bfde782ffbe0d1`
  const repoOrg = `stavalfi`
  const repoName = `nc`

  const cacheMountPath = `/p-volume-cache`

  await runK8sCommand(false, async () => {
    const pVolumeName = `p-volume-${chance().hash()}`
    await apiClient.createPersistentVolume({
      apiVersion: 'v1',
      kind: 'PersistentVolume',
      metadata: {
        name: pVolumeName,
      },
      spec: {
        persistentVolumeReclaimPolicy: 'Retain',
        storageClassName: 'manual1',
        capacity: {
          storage: '10Gi',
        },
        accessModes: ['ReadWriteOnce'],
        hostPath: {
          path: '/path-to-p-volume-in-host-vm',
        },
      },
    })
    console.log(pVolumeName)
  })

  await runK8sCommand(false, async () => {
    const pVolumeClaimName = `p-volume-claim-${chance().hash()}`
    await apiClient.createNamespacedPersistentVolumeClaim('default', {
      apiVersion: 'v1',
      kind: 'PersistentVolumeClaim',
      metadata: {
        name: pVolumeClaimName,
      },
      spec: {
        storageClassName: 'manual1',
        resources: {
          requests: {
            storage: '8Gi',
          },
        },
        accessModes: ['ReadWriteOnce'],
      },
    })
    console.log(pVolumeClaimName)
  })

  await runK8sCommand(true, async () => {
    const podName = `kaniko-pod-${chance().hash()}`
    await apiClient.createNamespacedPod('default', {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: {
        name: podName,
      },
      spec: {
        restartPolicy: 'Never',
        volumes: [
          {
            name: 'kaniko-secret',
            secret: {
              secretName: 'regcred',
              items: [
                {
                  key: '.dockerconfigjson',
                  path: 'config.json',
                },
              ],
            },
          },
        ],
        containers: [
          {
            name: 'kaniko',
            image: 'gcr.io/kaniko-project/executor:latest',
            args: [
              `--dockerfile=./packages/docker-poc/dockerfile`,
              `--context=git://${gitToken}@github.com/${repoOrg}/${repoName}.git#refs/heads/master`,
              '--destination=stavalfi/kaniko-poc:1.0.0',
            ],
            volumeMounts: [
              {
                name: 'kaniko-secret',
                mountPath: '/kaniko/.docker',
              },
            ],
          },
        ],
      },
    })
    console.log(podName)
  })

  await runK8sCommand(false, async () => {
    const podName = `pod-${chance().hash()}`
    const repoMountPath = `/project`
    await apiClient.createNamespacedPod('default', {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: {
        name: podName,
      },
      spec: {
        restartPolicy: 'Never',
        volumes: [
          {
            name: 'repository-content',
            emptyDir: {},
          },
          {
            name: 'persistent-cache',
            persistentVolumeClaim: {
              claimName: 'p-volume-claim-ed9caa06bf2ae2914c55382985740103188f0f2e',
            },
          },
        ],
        initContainers: [
          {
            name: 'git-clone',
            image: 'node:12',
            command: [
              'sh',
              '-c',
              `git clone https://${gitToken}@github.com/${repoOrg}/${repoName}.git ${repoMountPath}`,
            ],
            volumeMounts: [
              {
                name: 'repository-content',
                mountPath: repoMountPath,
              },
            ],
          },
          {
            name: 'install-project',
            image: 'node:12',
            command: [
              'sh',
              '-c',
              `yarn install --cwd ${repoMountPath} --cache-folder ${cacheMountPath}/yarn-global-cache`,
            ],
            volumeMounts: [
              {
                name: 'repository-content',
                mountPath: repoMountPath,
              },
              {
                name: 'persistent-cache',
                mountPath: cacheMountPath,
              },
            ],
          },
        ],
        containers: [
          {
            name: 'building-project',
            image: 'node:12',
            command: ['sh', '-c', `yarn --cwd ${repoMountPath} build`],
            volumeMounts: [
              {
                name: 'repository-content',
                mountPath: repoMountPath,
              },
            ],
          },
        ],
      },
    })
    console.log(podName)
  })
}

main()

// function getCloud8sClient() {
//   return getK8sClient({
//     k8sConnectionStrategyType: K8sConnectionStrategyType.specifyConnectionDetails,
//     connectionDetails: {
//       cluster: {
//         caData:
//           'LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSURERENDQWZTZ0F3SUJBZ0lSQUlkQ0lzWFhNMXF0R0pyLzhyK0NQbWt3RFFZSktvWklodmNOQVFFTEJRQXcKTHpFdE1Dc0dBMVVFQXhNa09UaG1ZVEZoTURZdFpERmlZaTAwWVRrM0xUbGlZemd0TlRrd05UZGtZVFV4Tm1WagpNQjRYRFRJd01EY3pNREEyTVRJMU5Wb1hEVEkxTURjeU9UQTNNVEkxTlZvd0x6RXRNQ3NHQTFVRUF4TWtPVGhtCllURmhNRFl0WkRGaVlpMDBZVGszTFRsaVl6Z3ROVGt3TlRka1lUVXhObVZqTUlJQklqQU5CZ2txaGtpRzl3MEIKQVFFRkFBT0NBUThBTUlJQkNnS0NBUUVBNU5xNlJpSXNrSEgzY0F0aGdOU2I5VGtuSm8rVWFHb0RiSnZvRVJOcApXemYyeHpGcDhIck9MYVJjbk4xVmRFK2REZFluOXFUdnh4QnIxbElqOERMWjVlMkxqSW9tOEM0RVhydTFmWTA4CnFnbnoxaGsvMk90VVlCUlpua0hyd0lQbmplMzVNQjZpbTlibTd2elk1ZEg2MXY4UCtjNnAxOWpMU0hDSWNDM24KK1Y4OElIM2Q0aUNHUWo4a1FSaFBBODNpSlRINGhFd0RBem83MDRTNXhaK2l2QktFNnpBYnRnR1E4S0JDd0xPWgptSTBkeDEvSW9tMW1XMDZFeGJDckp6M3k1T0g5enpJeE80b1dSMFV0UXo2aWF0R1F2K1FobHZFUlZFQ1VkUUFxCmlNU1RwdW5MVVNrUWRaaG82ZGQ2UGg2czUyUllJN3pud2xxTFAwZDZVelBQZFFJREFRQUJveU13SVRBT0JnTlYKSFE4QkFmOEVCQU1DQWdRd0R3WURWUjBUQVFIL0JBVXdBd0VCL3pBTkJna3Foa2lHOXcwQkFRc0ZBQU9DQVFFQQpoalJHc2RaU3ZaL1RsRksxNUdiS1RUb2J5SFAvcWp4MHBpQ2lTMStSRE5JMW5sOXVKaEFneTN5K2QzWTJvQU1YClloOTc0aEdxeFM3cXJrWWJ6bldGWXloSU5ZUnIrTmk4UWEvdnFLZUhGekRkdkF4RWkzaGNGaGRuUUYrKzF6OVkKT0N1MDluMEVweW9tVEdXbk1aVGtkMTk4b0l5WTZpTzB0TG5RUlZEZTJZZXBOYjVOSmc3UjhOMGRSYVZRS2d2UwpEb2M2UkhyOG0zMXJhRWVYSy9mNWl1V3NOSlRSSXE5S2t4dWw0OWlaZnJnNXRuV2E1NXpIZlFlaE9UQWQ4VFVzCklScUl6VEhtSzA2WWFQU2luemEreVI4RFIzbkwzSitIV2ZkTVBPblNXNmh1RDZnWEdTaks1TVhIdDJMZE9NNlkKREIxbmVhVkNOQWx6bE5YYVlhcUF6dz09Ci0tLS0tRU5EIENFUlRJRklDQVRFLS0tLS0K',
//         name: 'gke_dancer-staging-new_europe-west3-c_c-jxh57',
//         server: 'https://10001000.1000.1000.1000',
//         // server: 'https://34.89.228.243',
//         skipTLSVerify: false,
//       },
//       user: {
//         authProvider: {
//           config: {
//             'access-token':
//               'ya29.c.KpYB4Ad6pbI7k77rV-X0uFpxtBcHPFChl2j_grdqdRIiNNnzS8CnqtiG0Ha7Bn3JT-BPraHSuDMItg8Ck4C_5pWqDpgw5L8FPte9moqMF91W58txAF_C1vzrOA7Hr05uMt4NYcI1oBzzT6HEvwWIe0cpQnGnPlOrAOnLIdAxsU5Hf3LWEwXC2kHzzb3ZogbThz-cj9N2F4ZQ',
//             'cmd-args': 'config config-helper --format=json',
//             'cmd-path': '/usr/local/Caskroom/google-cloud-sdk/latest/google-cloud-sdk/bin/gcloud',
//             expiry: '2020-10-15T12:02:37Z',
//             'expiry-key': '{.credential.token_expiry}',
//             'token-key': '{.credential.access_token}',
//           },
//           name: 'gcp',
//         },
//         name: 'gke_dancer-staging-new_europe-west3-c_c-jxh57',
//       },
//       context: {
//         cluster: 'gke_dancer-staging-new_europe-west3-c_c-jxh57',
//         name: 'gke_dancer-staging-new_europe-west3-c_c-jxh57',
//         user: 'gke_dancer-staging-new_europe-west3-c_c-jxh57',
//       },
//     },
//   })
// }
