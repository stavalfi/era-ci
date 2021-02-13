import { Log, UserReturnValue } from '@era-ci/core'
import { ExecutionStatus, Status } from '@era-ci/utils'
import * as k8s from '@kubernetes/client-node'
import { EMPTY, firstValueFrom, Observable, of } from 'rxjs'
import { concatMap, filter, first, map, scan } from 'rxjs/operators'
import { DeepPartial } from 'ts-essentials'
import {
  DeploymentEvent,
  DeploymentStatus,
  DeploymentWatchResult,
  PodEvent,
  PodFailureReason,
  WatchEventType,
} from './types'

function extractPodContainersErrors(pod: k8s.V1Pod): PodFailureReason[] {
  return (
    pod.status?.containerStatuses
      ?.filter(s => ['ImagePullBackOff', 'CrashLoopBackOff'].includes(s.state?.waiting?.reason ?? ''))
      .map(c => c.state?.waiting?.reason! as PodFailureReason) ?? []
  )
}

function extractReplicaSetName(deployment: k8s.V1Deployment): string | undefined {
  const replicateSetCondition = deployment.status?.conditions?.find(c =>
    ['NewReplicaSetAvailable', 'ReplicaSetUpdated'].includes(c.reason ?? ''),
  )
  // I don't like it as much as you do but I couldn't find a better thread-safe way to do it:
  // https://github.com/kubernetes/kubectl/issues/1022#issuecomment-778195073
  const replicateSetName = replicateSetCondition?.message?.match(/ReplicaSet "(.*)"/)?.[1]
  return replicateSetName
}

function getUpdatedDeploymentStatus({
  reDeploymentResult,
  updatedDeployment,
  log,
}: {
  log: Log
  reDeploymentResult: k8s.V1Deployment
  updatedDeployment: k8s.V1Deployment
}): { newReplicaSetName?: string } & (
  | {
      status: DeploymentStatus.Succees | DeploymentStatus.NotReadyYet
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
      status: DeploymentStatus.NotReadyYet,
    }
  }

  if (currentGeneration > generationToTrackOn) {
    return {
      status: DeploymentStatus.ThereWasAddtionalDeployment,
      newDeploymentGeneration: currentGeneration,
      newReplicaSetName: extractReplicaSetName(updatedDeployment)!,
    }
  }

  // the following is a copy-paste from GO to NodeJS from kubectl source code to understand if the deployment passed
  // NOTE: it doesn't identify if one of the pod failed.
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
      // log.info(`stav1: ${JSON.stringify(reDeploymentResult, null, 2)}`)
      // log.info(`stav2: ${JSON.stringify(updatedDeployment, null, 2)}`)
      return { status: DeploymentStatus.Succees, newReplicaSetName: extractReplicaSetName(updatedDeployment)! }
    }
  }

  return { status: DeploymentStatus.NotReadyYet, newReplicaSetName: extractReplicaSetName(updatedDeployment) }
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

const getPodsEvents$ = ({
  kc,
  k8sNamesapce,
  replicaSetPodsToWatch,
}: {
  kc: k8s.KubeConfig
  k8sNamesapce: string
  replicaSetPodsToWatch: string
}) => {
  return new Observable<PodEvent>(observer => {
    const watch = new k8s.Watch(kc)
    let abortWatch: { abort: () => void } | undefined
    let closed = false
    watch
      .watch(
        `/api/v1/namespaces/${k8sNamesapce}/pods`,
        {},
        // NOTE: don't throw from this function because k8s-client will just hangs forever
        (type: string, updatedPod?: k8s.V1Pod) => {
          if (closed) {
            if (abortWatch) {
              abortWatch.abort()
            }
            return
          }
          const isPodBelongsToReplicaSet = updatedPod?.metadata?.ownerReferences?.some(
            o => o.kind === 'ReplicaSet' && o.name === replicaSetPodsToWatch,
          )
          if (!updatedPod || !isPodBelongsToReplicaSet) {
            return
          }
          switch (type) {
            case 'DELETED':
              return observer.next({ resourceKind: 'pod', eventType: WatchEventType.Deleted, resource: updatedPod })
            case 'ADDED':
              return observer.next({ resourceKind: 'pod', eventType: WatchEventType.Added, resource: updatedPod })
            case 'MODIFIED': {
              return observer.next({ resourceKind: 'pod', eventType: WatchEventType.Modified, resource: updatedPod })
            }
          }
        },
        function done() {
          closed = true
          return observer.complete()
        },
        function error(error: unknown) {
          return observer.error(error)
        },
      )
      .then(r => {
        abortWatch = r
      })

    return () => {
      closed = true
      if (abortWatch) {
        abortWatch.abort()
      }
    }
  })
}

const getDeploymentEvents$ = ({
  kc,
  k8sNamesapce,
  deploymentToTrackOn,
}: {
  kc: k8s.KubeConfig
  k8sNamesapce: string
  deploymentToTrackOn: k8s.V1Deployment
}) => {
  return new Observable<DeploymentEvent>(observer => {
    const initialDeploymentResourceRevision = deploymentToTrackOn.metadata?.resourceVersion
    if (!initialDeploymentResourceRevision) {
      throw new Error(`we can't be here20`)
    }
    const watch = new k8s.Watch(kc)
    let abortWatch: { abort: () => void } | undefined
    let closed = false
    watch
      .watch(
        `/apis/apps/v1/namespaces/${k8sNamesapce}/deployments`,
        {
          resourceVersion: initialDeploymentResourceRevision,
        },
        // NOTE: don't throw from this function because k8s-client will just hangs forever
        async (type: string, updatedDeployment?: k8s.V1Deployment) => {
          if (closed) {
            if (abortWatch) {
              abortWatch.abort()
            }
            return
          }
          if (!updatedDeployment || updatedDeployment.metadata?.name !== deploymentToTrackOn.metadata?.name) {
            return
          }
          switch (type) {
            case 'DELETED':
              observer.next({
                resourceKind: 'deployment',
                eventType: WatchEventType.Deleted,
                resource: updatedDeployment,
              })
              closed = true
              return observer.complete()
            case 'ADDED':
              observer.next({
                resourceKind: 'deployment',
                eventType: WatchEventType.Added,
                resource: updatedDeployment,
              })
              closed = true
              return observer.complete()
            case 'MODIFIED': {
              return observer.next({
                resourceKind: 'deployment',
                eventType: WatchEventType.Modified,
                resource: updatedDeployment,
              })
            }
          }
        },
        function done() {
          closed = true
          return observer.complete()
        },
        function error(error: unknown) {
          return observer.error(error)
        },
      )
      .then(r => {
        abortWatch = r
      })

    return () => {
      closed = true
      if (abortWatch) {
        abortWatch.abort()
      }
    }
  })
}

function processDeploymentResult({
  reDeploymentResult,
  k8sNamesapce,
  newFullImageName,
  deploymentResult,
  log,
}: {
  reDeploymentResult: k8s.V1Deployment
  k8sNamesapce: string
  log: Log
  deploymentResult: DeploymentWatchResult
  newFullImageName: string
}): UserReturnValue {
  switch (deploymentResult.status) {
    case DeploymentStatus.PodFailed: {
      const note = `failed to deploy. reason: pod: "${deploymentResult.podName}" failed to run. \
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
        new-deployment-generation: "${deploymentResult.newDeploymentGeneration}". for more help - run: \
        "kubectl rollout history -n ${k8sNamesapce} deploy ${reDeploymentResult.metadata?.name}"`

      log.error(note)

      return {
        executionStatus: ExecutionStatus.done,
        status: Status.failed,
        notes: [note],
      }
    }
    case DeploymentStatus.added: {
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

async function waitForDeploymentResult({
  reDeploymentResult,
  k8sNamesapce,
  log,
  kc,
  failDeplomentOnPodError,
}: {
  reDeploymentResult: k8s.V1Deployment
  k8sNamesapce: string
  log: Log
  kc: k8s.KubeConfig
  failDeplomentOnPodError: boolean
}) {
  let listenToPodsEvents = false
  return firstValueFrom(
    getDeploymentEvents$({
      deploymentToTrackOn: reDeploymentResult,
      k8sNamesapce,
      kc,
    }).pipe(
      concatMap<DeploymentEvent, Observable<DeploymentWatchResult>>(event => {
        // console.log('stav1', event.eventType, JSON.stringify(event.resource, null, 2))
        switch (event.eventType) {
          case WatchEventType.Added:
            return of({ status: DeploymentStatus.added })
          case WatchEventType.Deleted:
            return of({ status: DeploymentStatus.deleted })
          case WatchEventType.Modified: {
            const result = getUpdatedDeploymentStatus({
              reDeploymentResult,
              updatedDeployment: event.resource,
              log,
            })
            switch (result.status) {
              case DeploymentStatus.NotReadyYet:
                if (listenToPodsEvents || !result.newReplicaSetName || !failDeplomentOnPodError) {
                  return EMPTY
                } else {
                  listenToPodsEvents = true
                  // need to make sure that the pods are actually in ready state
                  return getPodsEvents$({
                    k8sNamesapce,
                    kc,
                    replicaSetPodsToWatch: result.newReplicaSetName,
                  }).pipe(
                    scan(
                      (acc: { podsReady: k8s.V1Pod[]; podError?: k8s.V1Pod }, event) => {
                        // console.log('stav2', event.eventType, JSON.stringify(event.resource, null, 2))
                        switch (event.eventType) {
                          case WatchEventType.Deleted:
                            return {
                              podsReady: acc.podsReady.filter(p => p.metadata?.name !== event.resource.metadata?.name),
                              podError:
                                acc.podError?.metadata?.name === event.resource.metadata?.name
                                  ? undefined
                                  : acc.podError,
                            }
                          case WatchEventType.Added:
                          case WatchEventType.Modified:
                            if (acc.podError?.metadata?.name === event.resource.metadata?.name) {
                              return acc
                            }
                            if (
                              event.resource.status?.containerStatuses?.every(
                                c => c.ready && c.state?.running?.startedAt,
                              )
                            ) {
                              if (acc.podsReady.some(p => p.metadata?.name === event.resource.metadata?.name)) {
                                return acc
                              } else {
                                const podsReady = [...acc.podsReady, event.resource]
                                log.info(
                                  `deployment: "${reDeploymentResult.metadata?.name}" - ${podsReady.length}/${reDeploymentResult.spec?.replicas} pods are ready`,
                                )
                                return {
                                  ...acc,
                                  podsReady,
                                }
                              }
                            }
                            if (extractPodContainersErrors(event.resource).length > 0) {
                              return {
                                ...acc,
                                podError: event.resource,
                              }
                            }
                            return acc
                        }
                      },
                      {
                        podsReady: [],
                      },
                    ),
                    filter(acc => Boolean(acc.podError) || acc.podsReady.length === reDeploymentResult.spec?.replicas),
                    first(),
                    map(acc => {
                      if (acc.podError) {
                        return {
                          status: DeploymentStatus.PodFailed,
                          podName: acc.podError.metadata?.name!,
                          reasons: extractPodContainersErrors(acc.podError),
                        }
                      } else {
                        return {
                          status: DeploymentStatus.Succees,
                        }
                      }
                    }),
                  )
                }
              case DeploymentStatus.ThereWasAddtionalDeployment:
                return of({
                  status: result.status,
                  newDeploymentGeneration: result.newDeploymentGeneration,
                })
              case DeploymentStatus.Timeout:
                return of({
                  status: result.status,
                  replicateSetNameWithTimeout: result.replicateSetNameWithTimeout,
                })
              case DeploymentStatus.Succees: {
                return of({
                  status: DeploymentStatus.Succees,
                })
              }
            }
          }
        }
      }),
    ),
  )
}

export async function deployAndWait({
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
}): Promise<UserReturnValue> {
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

  const deploymentResult = await waitForDeploymentResult({
    reDeploymentResult,
    k8sNamesapce,
    log,
    failDeplomentOnPodError,
    kc,
  })

  return processDeploymentResult({
    reDeploymentResult,
    k8sNamesapce,
    newFullImageName,
    deploymentResult,
    log,
  })
}
