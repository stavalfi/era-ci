/* eslint-disable no-console */
import * as k8s from '@kubernetes/client-node'
import chance from 'chance'
import got from 'got'
import _ from 'lodash'

async function main4() {
  const token = `6IK4RgUHNoG380SCSLJdCmzbAy0pgXFmyYEY2Jcc`
  // // const gitToken = `37e7707f7a07bea84d55d46c48bfde782ffbe0d1`
  // // const privateRepo = `https://github.com/stavalfi/nc/archive/master.tar.gz`
  await Promise.all(
    _.range(10, 25).map(async i => {
      // await got.post(`https://quay.io/api/v1/repository`, {
      //   headers: {
      //     Authorization: `Bearer ${token}`,
      //   },
      //   json: {
      //     repo_kind: 'image',
      //     namespace: 'stav1991',
      //     visibility: 'public',
      //     repository: `repo${i}`,
      //     description: 'cool repo',
      //   },
      //   responseType: 'json',
      //   resolveBodyOnly: true,
      // })

      const result2 = await got.post(`https://quay.io/api/v1/repository/stav1991/repo${i}/build/`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        json: {
          // proxy archive_url: http://127.0.0.1:8080/download-git-repo-tar-gz?git_registry=github&git_org=stavalfi&git_repo=nc&commit=master
          archive_url: `https://github.com/stavalfi/k8test/archive/2a6072a4d6f5becbf2272f71619646de4cd5a296.tar.gz`,
          docker_tags: [`test-build`],
          context: `/k8test-2a6072a4d6f5becbf2272f71619646de4cd5a296`,
          dockerfile_path: `/k8test-2a6072a4d6f5becbf2272f71619646de4cd5a296/packages/dockerhub-build-poc/Dockerfile`,
        },
        responseType: 'json',
        resolveBodyOnly: true,
        retry: {
          maxRetryAfter: 5,
          calculateDelay: r => r.attemptCount * 5_000,
        },
      })

      console.log(result2)
    }),
  )
}

main4()

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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function main2() {
  // const kc = getMinikubeClient()
  const kc = getK8sClient({
    k8sConnectionStrategyType: K8sConnectionStrategyType.tryReadFromLocalMachine,
  })

  const apiClient = kc.makeApiClient(k8s.CoreV1Api)
  const batchClient = kc.makeApiClient(k8s.BatchV1Api)
  const k8sLog = new k8s.Log(kc)

  await runK8sCommand(true, async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const result = await k8sLog.log(
      'default',
      'job-example2-9hh74',
      'example1',
      process.stdout,
      () => {
        console.log('--')
      },
      {
        follow: true,
        previous: false,
      },
    )
  })

  const gitToken = `37e7707f7a07bea84d55d46c48bfde782ffbe0d1`
  const repoOrg = `stavalfi`
  const repoName = `nc`

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

  await runK8sCommand(false, async () => {
    const podName = `job-${chance().hash()}`
    const reposMountPath = `/flows`
    const repoMountPath = `${reposMountPath}/flow-hash-130-${chance().hash()}`
    const cacheMountPath = `/p-volume-cache`

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
                name: 'persistent-cache',
                persistentVolumeClaim: {
                  claimName: 'p-volume-claim-39ed95b0d804564fca0192e4c7f72838f4bab7a2',
                },
              },
              {
                name: 'docker-config-secret',
                secret: {
                  secretName: 'secret-0db9d1f0e21d2093bbfd0ccbca4d1230d4d9ac1b',
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
                  `git clone https://${gitToken}@github.com/${repoOrg}/${repoName}.git --depth=1 --branch stav/break-to-modules --single-branch ${repoMountPath}`,
                ],
                volumeMounts: [
                  {
                    name: 'persistent-cache',
                    mountPath: reposMountPath,
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
                    name: 'persistent-cache',
                    mountPath: reposMountPath,
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
                    name: 'persistent-cache',
                    mountPath: reposMountPath,
                  },
                ],
              },
              {
                name: 'docker-build-push',
                image: 'moby/buildkit:master',
                command: [`buildctl-daemonless.sh`],
                args: `build \
--frontend dockerfile.v0 \
--local context=${repoMountPath} \
--local dockerfile=${repoMountPath}/packages/dockerhub-build-poc \
--output type=image,name=registry.hub.docker.com/stavalfi/buildkit-poc:1.0.2,push=true \
--export-cache type=local,dest=/docker-layers-cache \
--import-cache type=local,src=/docker-layers-cache`.split(' '),
                securityContext: {
                  privileged: true,
                },
                env: [
                  {
                    name: 'DOCKER_CONFIG',
                    value: `/.docker`,
                  },
                ],
                volumeMounts: [
                  {
                    name: 'persistent-cache',
                    mountPath: reposMountPath,
                  },
                  {
                    name: 'docker-config-secret',
                    mountPath: '/.docker',
                  },
                  {
                    name: 'persistent-cache',
                    mountPath: '/docker-layers-cache',
                  },
                ],
              },
            ],
            containers: [
              {
                name: 'building-project',
                image: 'node:12',
                command: ['sh', '-c', `echo hi`],
                volumeMounts: [
                  {
                    name: 'persistent-cache',
                    mountPath: reposMountPath,
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
    const podName = `job-example2`
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
            containers: [
              {
                name: 'example1',
                image: 'node:12',
                command: ['sh', '-c', `node -e "setInterval(()=>console.log(1),1000)"`],
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
