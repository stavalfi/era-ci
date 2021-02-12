import {
  skipIfArtifactStepResultMissingOrFailedInCacheConstrain,
  skipIfStepIsDisabledConstrain,
} from '@era-ci/constrains'
import { ConstrainResultType, createConstrain, createStep, getReturnValue, Log, UserReturnValue } from '@era-ci/core'
import { LocalSequentalTaskQueue } from '@era-ci/task-queues'
import { Artifact, ExecutionStatus, getPackageTargetTypes, Node, Status, TargetType } from '@era-ci/utils'
import * as k8s from '@kubernetes/client-node'
import _ from 'lodash'
import { DeepPartial } from 'ts-essentials'

export type k8sDeploymentConfiguration = {
  isStepEnabled: boolean
  kubeConfigBase64: string
  k8sNamesapce: string
  artifactNameToDeploymentName: (options: { artifactName: string }) => string
  artifactNameToContainerName: (options: { artifactName: string }) => string
  ignorePackageNames?: string[]
  failDeplomentOnPodError: boolean
}

const customConstrain = createConstrain<
  { currentArtifact: Node<{ artifact: Artifact }> },
  { currentArtifact: Node<{ artifact: Artifact }> },
  Required<k8sDeploymentConfiguration>
>({
  constrainName: 'custom-constrain',
  constrain: async ({ constrainConfigurations: { currentArtifact }, stepConfigurations }) => {
    const targetTypes = await getPackageTargetTypes(
      currentArtifact.data.artifact.packagePath,
      currentArtifact.data.artifact.packageJson,
    )
    if (
      !targetTypes.includes(TargetType.docker) ||
      stepConfigurations.ignorePackageNames.includes(currentArtifact.data.artifact.packageJson.name)
    ) {
      return {
        resultType: ConstrainResultType.shouldSkip,
        result: {
          errors: [],
          notes: [],
          executionStatus: ExecutionStatus.aborted,
          status: Status.skippedAsPassed,
        },
      }
    }

    return {
      resultType: ConstrainResultType.ignoreThisConstrain,
      result: { errors: [], notes: [] },
    }
  },
})

function extractReplicaSetName(deployment: k8s.V1Deployment): string | undefined {
  const replicateSetCondition = deployment.status?.conditions?.find(c =>
    ['NewReplicaSetAvailable', 'ReplicaSetUpdated'].includes(c.reason ?? ''),
  )
  // I don't like it as much as you do but I couldn't find a better thread-safe way to do it:
  // https://github.com/kubernetes/kubectl/issues/1022#issuecomment-778195073
  const replicateSetName = replicateSetCondition?.message?.match(/ReplicaSet "(.*)"/)?.[1]
  return replicateSetName
}

enum DeploymentStatus {
  NotReadYet = 'deployment---NotReadYet',
  PodFailed = 'deployment---pod-failed',
  ThereWasAddtionalDeployment = 'deployment---there-was-addtional-deployment',
  Timeout = 'deployment---timeout',
  Succees = 'deployment---success',
  deleted = 'deployment---deleted',
  created = 'deployment---created',
}

function getUpdatedDeploymentStatus({
  reDeploymentResult,
  updatedDeployment,
}: {
  reDeploymentResult: k8s.V1Deployment
  updatedDeployment: k8s.V1Deployment
}): { newReplicaSetName?: string } & (
  | {
      status: DeploymentStatus.Succees | DeploymentStatus.NotReadYet
    }
  | { status: DeploymentStatus.Timeout; replicateSetNameWithTimeout: string }
  | { status: DeploymentStatus.ThereWasAddtionalDeployment; newDeploymentGeneration: number }
) {
  // https://stackoverflow.com/questions/47100389/what-is-the-difference-between-a-resourceversion-and-a-generation/66092577#66092577
  // generation === the id of the replicateSet which a deployment should track on.
  // observedGeneration === the id of the replicateSet which a deployment track on right now.
  // `observedGeneration` will equal to `generation` when the new replicateSet is ready

  // the generation we need to track on in this CI-Build
  const generationToTrackOn = reDeploymentResult.metadata?.generation
  // the most up to date generation of this deployment
  const currentGeneration = updatedDeployment.metadata?.generation

  // the most up to date observedGeneration of this deployment
  const currentObservedGeneration = updatedDeployment.status?.observedGeneration

  if (generationToTrackOn === undefined || currentGeneration === undefined || currentObservedGeneration === undefined) {
    return {
      status: DeploymentStatus.NotReadYet,
    }
  }

  if (currentGeneration > generationToTrackOn) {
    return {
      status: DeploymentStatus.ThereWasAddtionalDeployment,
      newDeploymentGeneration: currentGeneration,
      newReplicaSetName: extractReplicaSetName(updatedDeployment)!,
    }
  }

  // the following is a copy-paste from GO to NodeJS from kubectl source code to understand if the deployment passed or failed:
  // https://github.com/kubernetes/kubectl/blob/a2d36ec6d62f756e72fb3a5f49ed0f720ad0fe83/pkg/polymorphichelpers/rollout_status.go#L75'

  if (currentGeneration === currentObservedGeneration) {
    const progressingCondition = updatedDeployment.status?.conditions?.find(c => c.type === 'Progressing')
    // https://github.com/uswitch/kubernetes-autoscaler/blob/master/cluster-autoscaler/vendor/k8s.io/kubernetes/pkg/kubectl/util/deployment/deployment.go#L52
    if (progressingCondition?.reason === 'ProgressDeadlineExceeded') {
      return {
        status: DeploymentStatus.Timeout,
        replicateSetNameWithTimeout: extractReplicaSetName(updatedDeployment)!,
        newReplicaSetName: extractReplicaSetName(updatedDeployment)!,
      }
    }
    if (
      updatedDeployment.spec?.replicas !== undefined &&
      updatedDeployment.status?.replicas !== undefined &&
      updatedDeployment.status.updatedReplicas !== undefined &&
      updatedDeployment.status.replicas === updatedDeployment.spec.replicas &&
      updatedDeployment.status.replicas === updatedDeployment.status.updatedReplicas &&
      updatedDeployment.status.replicas === updatedDeployment.status.availableReplicas
    ) {
      // eslint-disable-next-line no-console
      console.log('stav1', JSON.stringify(reDeploymentResult, null, 2))
      // eslint-disable-next-line no-console
      console.log('stav2', JSON.stringify(updatedDeployment, null, 2))
      return { status: DeploymentStatus.Succees, newReplicaSetName: extractReplicaSetName(updatedDeployment)! }
    }
  }

  return { status: DeploymentStatus.NotReadYet, newReplicaSetName: extractReplicaSetName(updatedDeployment) }
}

const deploy = async ({
  changeCause,
  containerName,
  deploymentApi,
  fullImageName,
  deploymentName,
  k8sNamesapce,
}: {
  changeCause: string
  deploymentName: string
  deploymentApi: k8s.AppsV1Api
  containerName: string
  fullImageName: string
  k8sNamesapce: string
}): Promise<k8s.V1Deployment> => {
  try {
    const update: DeepPartial<k8s.V1Deployment> = {
      metadata: {
        annotations: {
          // it will appear when running: `kubectl rollout history deploy <deployment-name>` under: `CHANGE-CAUSE` column
          'kubernetes.io/change-cause': changeCause,
        },
      },
      spec: {
        template: {
          spec: {
            containers: [
              {
                name: containerName,
                image: fullImageName,
              },
            ],
          },
        },
      },
    }
    const newDeployment = await deploymentApi.patchNamespacedDeployment(
      deploymentName,
      k8sNamesapce,
      update,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        headers: { 'content-type': 'application/merge-patch+json' },
      },
    )
    return newDeployment.body
  } catch (e) {
    throw new Error(`failed to change deployment image. error: ${JSON.stringify(e.response, null, 2)}`)
  }
}

enum PodStatus {
  failed = 'pod---NotReadYet',
  somethingElse = 'pod---something-else',
}

enum PodFailureReason {
  ImagePullBackOff = 'ImagePullBackOff',
  CrashLoopBackOff = 'CrashLoopBackOff',
}

type PodWatchResult =
  | { status: PodStatus.somethingElse }
  | { status: PodStatus.failed; reason: PodFailureReason; podName: string }

// this function is the best implementation I could think of on how to identify that a pod failed.
// I probably missed alot of other reasons but that's ok because 99% of the time, it will be
// because of image not available or a code-bug in the image and we identity it here.
// for any other reason, to make sure that Era-ci don't hangs while one of the pods failed:
// specify 'progressDeadlineSeconds' in the deployment and the deployment-watch will cancel & revert the deployment.
const waitPodFailure = ({
  kc,
  k8sNamesapce,
  replicaSetPodsToWatch,
}: {
  kc: k8s.KubeConfig
  k8sNamesapce: string
  replicaSetPodsToWatch: string
}) => {
  const watch = new k8s.Watch(kc)
  let watchResponse: { abort: () => void }
  return {
    abortWatch: () => watchResponse.abort(),
    startWatch: () =>
      new Promise<PodWatchResult>((res, rej) => {
        if (watchResponse) {
          return rej('watch already started')
        }
        watch
          .watch(
            `/api/v1/namespaces/${k8sNamesapce}/pods`,
            {},
            // NOTE: don't throw from this function because k8s-client will just hangs forever
            (type: string, updatedPod?: k8s.V1Pod) => {
              const isPodBelongsToReplicaSet = updatedPod?.metadata?.ownerReferences?.some(
                o => o.kind === 'ReplicaSet' && o.name === replicaSetPodsToWatch,
              )
              if (!updatedPod || !isPodBelongsToReplicaSet) {
                return
              }
              switch (type) {
                case 'DELETED':
                  break
                case 'ADDED':
                case 'MODIFIED': {
                  const failure = updatedPod.status?.containerStatuses?.find(s =>
                    ['ImagePullBackOff', 'CrashLoopBackOff'].includes(s.state?.waiting?.reason ?? ''),
                  )
                  if (failure) {
                    watchResponse.abort()
                    res({
                      status: PodStatus.failed,
                      reason: failure.state?.waiting?.reason! as PodFailureReason,
                      podName: updatedPod.metadata?.name!,
                    })
                  }
                  break
                }
              }
            },
            function done() {
              // if we are here, it means that we closed the watch from this function or the deployment-watch finished/failed first
              res({ status: PodStatus.somethingElse })
            },
            function error(error: unknown) {
              rej(error)
            },
          )
          .then(r => {
            watchResponse = r
          })
      }),
  }
}

type DeploymentWatchResult =
  | {
      status: DeploymentStatus.Succees | DeploymentStatus.created | DeploymentStatus.deleted
    }
  | { status: DeploymentStatus.Timeout; replicateSetNameWithTimeout: string }
  | { status: DeploymentStatus.ThereWasAddtionalDeployment; newDeploymentGeneration: number }
  | { status: DeploymentStatus.PodFailed; reason: PodFailureReason; podName: string }

const waitDeploymentReady = ({
  kc,
  k8sNamesapce,
  reDeploymentResult,
  failDeplomentOnPodError,
}: {
  kc: k8s.KubeConfig
  k8sNamesapce: string
  reDeploymentResult: k8s.V1Deployment
  failDeplomentOnPodError: boolean
}) => {
  const watch = new k8s.Watch(kc)
  let abortDeploymentWatch: { abort: () => void }
  let abortPodWatch: () => void
  return {
    abortWatch: () => abortDeploymentWatch.abort(),
    startWatch: () =>
      new Promise<DeploymentWatchResult>((res, rej) => {
        if (abortDeploymentWatch) {
          return rej('watch already started')
        }
        const requestedDeploymentRevision =
          reDeploymentResult.metadata?.annotations?.['deployment.kubernetes.io/revision']
        const initialDeploymentResourceRevision = reDeploymentResult.metadata?.resourceVersion
        if (!initialDeploymentResourceRevision) {
          throw new Error(`we can't be here20`)
        }
        if (!requestedDeploymentRevision) {
          throw new Error(`we can't be here21`)
        }
        watch
          .watch(
            `/apis/apps/v1/namespaces/${k8sNamesapce}/deployments`,
            {
              resourceVersion: initialDeploymentResourceRevision,
            },
            // NOTE: don't throw from this function because k8s-client will just hangs forever
            async (type: string, updatedDeployment?: k8s.V1Deployment) => {
              if (!updatedDeployment || updatedDeployment.metadata?.name !== reDeploymentResult.metadata?.name) {
                return
              }
              switch (type) {
                case 'DELETED':
                  abortDeploymentWatch.abort()
                  res({ status: DeploymentStatus.deleted })
                  break
                case 'ADDED':
                  abortDeploymentWatch.abort()
                  res({ status: DeploymentStatus.created })
                  break
                case 'MODIFIED': {
                  const result = getUpdatedDeploymentStatus({
                    reDeploymentResult,
                    updatedDeployment,
                  })
                  switch (result.status) {
                    case DeploymentStatus.NotReadYet:
                      if (result.newReplicaSetName && !abortPodWatch && failDeplomentOnPodError) {
                        const podWatch = waitPodFailure({
                          k8sNamesapce,
                          kc,
                          replicaSetPodsToWatch: result.newReplicaSetName,
                        })
                        abortPodWatch = podWatch.abortWatch
                        const podResult = await podWatch.startWatch()
                        if (podResult.status === PodStatus.failed) {
                          abortDeploymentWatch.abort()
                          return res({
                            status: DeploymentStatus.PodFailed,
                            podName: podResult.podName,
                            reason: podResult.reason,
                          })
                        }
                      }
                      return
                    case DeploymentStatus.ThereWasAddtionalDeployment:
                      abortDeploymentWatch.abort()
                      if (abortPodWatch) {
                        abortPodWatch()
                      }
                      res({
                        status: result.status,
                        newDeploymentGeneration: result.newDeploymentGeneration,
                      })
                      return
                    case DeploymentStatus.Succees:
                      abortDeploymentWatch.abort()
                      if (abortPodWatch) {
                        abortPodWatch()
                      }
                      res({
                        status: result.status,
                      })
                      return
                    case DeploymentStatus.Timeout:
                      abortDeploymentWatch.abort()
                      if (abortPodWatch) {
                        abortPodWatch()
                      }
                      res({
                        status: result.status,
                        replicateSetNameWithTimeout: result.replicateSetNameWithTimeout,
                      })
                      return
                  }
                }
              }
            },
            function done() {
              rej(
                new Error(
                  `if we are here, it means that we already resolved the promise so the rejection will be ignored. if you see this error, then it means you found a bug.`,
                ),
              )
            },
            function error(error: unknown) {
              rej(error)
            },
          )
          .then(r => {
            abortDeploymentWatch = r
          })
      }),
  }
}

async function deployAndWait({
  log,
  changeCause,
  deploymentName,
  k8sNamesapce,
  newFullImageName,
  deploymentApi,
  containerName,
  kc,
  failDeplomentOnPodError,
}: {
  containerName: string
  changeCause: string
  newFullImageName: string
  deploymentApi: k8s.AppsV1Api
  deploymentName: string
  k8sNamesapce: string
  log: Log
  kc: k8s.KubeConfig
  failDeplomentOnPodError: boolean
}): Promise<UserReturnValue | undefined | void> {
  log.info(`trying to deploy image: "${newFullImageName}" in deployment: "${deploymentName}"`)

  const reDeploymentResult = await deploy({
    changeCause,
    containerName,
    fullImageName: newFullImageName,
    deploymentApi,
    deploymentName,
    k8sNamesapce,
  })

  if (reDeploymentResult.metadata?.generation === reDeploymentResult.status?.observedGeneration) {
    return {
      executionStatus: ExecutionStatus.aborted,
      status: Status.skippedAsPassed,
      notes: [`nothing new to deploy`],
    }
  }

  const newReplicaSetName = extractReplicaSetName(reDeploymentResult)
  if (!newReplicaSetName) {
    throw new Error(`can't find replicaSet name of the deployment`)
  }

  const deploymentWatch = waitDeploymentReady({
    reDeploymentResult,
    k8sNamesapce,
    kc,
    failDeplomentOnPodError,
  })

  const result = await deploymentWatch.startWatch()

  switch (result.status) {
    case DeploymentStatus.PodFailed: {
      const note = `failed to deploy. reason: pod: "${result.podName}" failed to run. \
manually check the problem, commit a fix and run the CI again`

      log.error(note)

      return {
        executionStatus: ExecutionStatus.done,
        status: Status.failed,
        notes: [note],
      }
    }
    case DeploymentStatus.Succees: {
      const note = `successfully deployd image: "${newFullImageName}"`

      log.info(note)

      return {
        executionStatus: ExecutionStatus.done,
        status: Status.passed,
        notes: [note],
      }
    }
    case DeploymentStatus.ThereWasAddtionalDeployment: {
      const note = `failed to deploy. reason: there was a new deployment while \
waiting until the requested deployment will be ready. requested-deployment-generation: "${reDeploymentResult.metadata?.generation}". \
new-deployment-generation: "${result.newDeploymentGeneration}". for more help - run: \
"kubectl rollout history -n ${k8sNamesapce} deploy ${reDeploymentResult.metadata?.name}"`

      log.error(note)

      return {
        executionStatus: ExecutionStatus.done,
        status: Status.failed,
        notes: [note],
      }
    }
    case DeploymentStatus.created: {
      const note = `failed to deploy. reason: the deployment was deleted \
and recreated while the CI was running. please check it out and run the CI again after it is finished`

      log.error(note)

      return {
        executionStatus: ExecutionStatus.done,
        status: Status.failed,
        notes: [note],
      }
    }
    case DeploymentStatus.deleted: {
      const note = `failed to deploy. reason: the deployment was deleted. \
please check it out and run the CI again after it is finished`

      log.error(note)

      return {
        executionStatus: ExecutionStatus.done,
        status: Status.failed,
        notes: [note],
      }
    }
    case DeploymentStatus.Timeout: {
      const timeoutSeconds = reDeploymentResult.spec?.progressDeadlineSeconds!

      const note = `failed to deploy. reason: the specified timeout (progressDeadlineSeconds) \
was reached: "${timeoutSeconds}" seconds. manually check the problem, commit a fix and run the CI again`

      log.error(note)

      return {
        executionStatus: ExecutionStatus.done,
        status: Status.failed,
        notes: [note],
      }
    }
  }
}

export const k8sDeployment = createStep<
  LocalSequentalTaskQueue,
  k8sDeploymentConfiguration,
  Required<k8sDeploymentConfiguration>
>({
  stepName: 'k8s-deployment',
  stepGroup: 'k8s-deployment',
  taskQueueClass: LocalSequentalTaskQueue,
  normalizeStepConfigurations: async config => ({
    ...config,
    ignorePackageNames: config.ignorePackageNames ?? [],
  }),
  run: async ({ stepConfigurations, getState, steps, artifacts, log }) => {
    const kc = new k8s.KubeConfig()
    kc.loadFromString(Buffer.from(stepConfigurations.kubeConfigBase64, 'base64').toString())
    const deploymentApi = kc.makeApiClient(k8s.AppsV1Api)

    return {
      globalConstrains: [skipIfStepIsDisabledConstrain()],
      artifactConstrains: [
        artifact =>
          skipIfArtifactStepResultMissingOrFailedInCacheConstrain({
            currentArtifact: artifact,
            stepNameToSearchInCache: 'docker-publish',
            skipAsPassedIfStepNotExists: false,
          }),
        artifact => customConstrain({ currentArtifact: artifact }),
      ],
      onBeforeArtifacts: async () => log.info(`starting to deploy to k8s. Please don't stop the CI manually!`),
      onArtifact: async ({ artifact }) => {
        const artifactName = artifact.data.artifact.packageJson.name
        const deploymentName = stepConfigurations.artifactNameToDeploymentName({ artifactName })
        const containerName = stepConfigurations.artifactNameToContainerName({ artifactName })

        const newFullImageName = getReturnValue<string>({
          state: getState(),
          artifacts,
          steps,
          artifactName: artifact.data.artifact.packageJson.name,
          stepGroup: 'docker-publish',
          mapper: _.identity,
        })

        return deployAndWait({
          kc,
          deploymentApi,
          changeCause: `era-ci automation - to image (image-name:<version=git-revision>): ${newFullImageName}`,
          log,
          newFullImageName,
          k8sNamesapce: stepConfigurations.k8sNamesapce,
          deploymentName,
          containerName,
          failDeplomentOnPodError: stepConfigurations.failDeplomentOnPodError,
        })
      },
    }
  },
})
