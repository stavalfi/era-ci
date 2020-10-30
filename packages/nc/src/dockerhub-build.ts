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
      kc.loadFromOptions({
        clusters: [options.connectionDetails.cluster],
        users: [options.connectionDetails.user],
        contexts: [options.connectionDetails.context],
        currentContext: options.connectionDetails.context.name,
      })
      break
    case K8sConnectionStrategyType.tryReadFromLocalMachine:
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
        server: 'https://127.0.0.1:32768',
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

async function main2() {
  const kc = getMinikubeClient()

  const apiClient = kc.makeApiClient(k8s.CoreV1Api)
  const batchClient = kc.makeApiClient(k8s.BatchV1Api)

  const gitToken = `37e7707f7a07bea84d55d46c48bfde782ffbe0d1`
  const repoOrg = `stavalfi`
  const repoName = `nc`

  const cacheMountPath = `/p-volume-cache`

  await runK8sCommand(false, async () => {
    const secretName = `secret-${chance().hash()}`
    const dockerConfigBase64 = Buffer.from(
      JSON.stringify({
        auths: {
          'registry.hub.docker.com': {
            auth: 'c3RhdmFsZmk6c3RhdmFsZmk2MzUzODM=',
            email: 'stavalfi@gmail.com',
          },
        },
      }),
    ).toString('base64')

    await apiClient.createNamespacedSecret('default', {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: {
        name: secretName,
      },
      type: 'kubernetes.io/dockerconfigjson',
      data: {
        '.dockerconfigjson': dockerConfigBase64,
      },
    })
    console.log(secretName)
  })

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
    const podName = `job-${chance().hash()}`
    const repoMountPath = `/project`
    await batchClient.createNamespacedJob('default', {
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: {
        name: podName,
      },
      spec: {
        ttlSecondsAfterFinished: 60 * 60 * 24,
        template: {
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
                  claimName: 'p-volume-claim-13ac1ec1b119942893b94db700d28db2cdfae111',
                },
              },
              {
                name: 'docker-config-secret',
                secret: {
                  secretName: 'secret-0347291de7826e59657d7e831c0bb0bb44b2129d',
                  items: [
                    {
                      key: '.dockerconfigjson',
                      path: 'config.json',
                    },
                  ],
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
                name: 'install',
                image: 'node:12',
                command: [
                  'sh',
                  '-c',
                  `yarn --cwd ${repoMountPath} --cache-folder ${cacheMountPath}/yarn-global-cache install`,
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
              {
                name: 'compile',
                image: 'node:12',
                command: ['sh', '-c', `yarn --cwd ${repoMountPath} build`],
                volumeMounts: [
                  {
                    name: 'repository-content',
                    mountPath: repoMountPath,
                  },
                ],
              },
              {
                name: 'docker-build-push',
                image: 'moby/buildkit:master',
                command: ['buildctl'],
                args: [
                  `build`,
                  ...`--frontend dockerfile.v0`.split(' '),
                  ...`--local context=${repoMountPath}`.split(' '),
                  ...`--local dockerfile=${repoMountPath}/packages/dockerhub-build-poc`.split(' '),
                  ...`--output type=image,name=registry.hub.docker.com/stavalfi/buildkit-poc:1.0.1,push=true`.split(
                    ' ',
                  ),
                  ...`--export-cache type=inline`.split(' '),
                  ...`--import-cache type=registry,ref=registry.hub.docker.com/stavalfi/buildkit-poc:buildcache`.split(
                    ' ',
                  ),
                ],
                volumeMounts: [
                  {
                    name: 'repository-content',
                    mountPath: repoMountPath,
                  },
                  {
                    name: 'docker-config-secret',
                    mountPath: '/.docker',
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
        },
      },
    })
    console.log(podName)
  })

  await runK8sCommand(false, async () => {
    const podName = `kaniko-job-${chance().hash()}`
    await batchClient.createNamespacedJob('default', {
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: {
        name: podName,
      },
      spec: {
        ttlSecondsAfterFinished: 60 * 60 * 24,
        template: {
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
                  `--cache=true`,
                  `--snapshotMode=redo`,
                  `--dockerfile=./packages/docker-poc/dockerfile`,
                  `--context=git://${gitToken}@github.com/${repoOrg}/${repoName}.git#refs/heads/brigade-poc`,
                  '--destination=stavalfi/kaniko-poc:1.0.5',
                  '--cache-repo=stavalfi/kaniko-bug-cache',
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
        },
      },
    })
    console.log(podName)
  })
}

main2()
