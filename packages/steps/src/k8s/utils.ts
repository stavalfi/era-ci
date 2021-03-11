import { Log, UserReturnValue } from '@era-ci/core'
import { ExecutionStatus, Status } from '@era-ci/utils'
import * as k8s from '@kubernetes/client-node'
import _ from 'lodash'
import { defer, EMPTY, firstValueFrom, Observable, of } from 'rxjs'
import { concatMap, filter, first, scan } from 'rxjs/operators'
import type { DeepPartial } from 'ts-essentials'
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

function getUpdatedDeploymentStatus({
  reDeploymentResult,
  updatedDeployment,
  log,
  isTestMode,
}: {
  log: Log
  reDeploymentResult: k8s.V1Deployment
  updatedDeployment: k8s.V1Deployment
  isTestMode: boolean
}):
  | {
      status: DeploymentStatus.Succees | DeploymentStatus.NotReadyYet
    }
  | { status: DeploymentStatus.Timeout }
  | { status: DeploymentStatus.ThereWasAddtionalDeployment; newDeploymentGeneration: number } {
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
      if (isTestMode) {
        log.info(`stav1`, { reDeploymentResult })
        log.info(`stav2`, { updatedDeployment })
      }
      return { status: DeploymentStatus.Succees }
    }
  }

  return { status: DeploymentStatus.NotReadyYet }
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
  deploymentApi,
  isTestMode,
}: {
  reDeploymentResult: k8s.V1Deployment
  k8sNamesapce: string
  log: Log
  kc: k8s.KubeConfig
  failDeplomentOnPodError: boolean
  deploymentApi: k8s.AppsV1Api
  isTestMode: boolean
}): Promise<DeploymentWatchResult> {
  let podsSuccess = false
  let deploymentSuccess = false
  let alreadyListeningToPodsEvents = false
  return firstValueFrom(
    getDeploymentEvents$({
      deploymentToTrackOn: reDeploymentResult,
      k8sNamesapce,
      kc,
    }).pipe(
      concatMap<DeploymentEvent, Observable<DeploymentWatchResult>>(event => {
        if (isTestMode) {
          log.info('stav3', event)
        }
        switch (event.eventType) {
          case WatchEventType.Added:
            return of({ status: DeploymentStatus.added })
          case WatchEventType.Deleted:
            return of({ status: DeploymentStatus.deleted })
          case WatchEventType.Modified: {
            return defer(() =>
              findReplicaSetOfDeployment({ deploymentApi, deployment: event.resource, k8sNamesapce }),
            ).pipe(
              concatMap<k8s.V1ReplicaSet, Observable<DeploymentWatchResult>>(updatedDeploymentReplicaSet => {
                const result = getUpdatedDeploymentStatus({
                  reDeploymentResult,
                  updatedDeployment: event.resource,
                  log,
                  isTestMode,
                })
                switch (result.status) {
                  case DeploymentStatus.NotReadyYet:
                    if (alreadyListeningToPodsEvents || !failDeplomentOnPodError) {
                      return EMPTY
                    } else {
                      alreadyListeningToPodsEvents = true
                      // need to make sure that the pods are actually in ready state
                      return getPodsEvents$({
                        k8sNamesapce,
                        kc,
                        replicaSetPodsToWatch: updatedDeploymentReplicaSet.metadata?.name!,
                      }).pipe(
                        scan(
                          (acc: { podsReady: k8s.V1Pod[]; podError?: k8s.V1Pod }, event) => {
                            if (isTestMode) {
                              log.info('stav4', event)
                            }
                            switch (event.eventType) {
                              case WatchEventType.Deleted:
                                return {
                                  podsReady: acc.podsReady.filter(
                                    p => p.metadata?.name !== event.resource.metadata?.name,
                                  ),
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
                        filter(
                          acc => Boolean(acc.podError) || acc.podsReady.length === reDeploymentResult.spec?.replicas,
                        ),
                        first(),
                        concatMap<
                          {
                            podsReady: k8s.V1Pod[]
                            podError?: k8s.V1Pod | undefined
                          },
                          Observable<DeploymentWatchResult>
                        >(acc => {
                          if (acc.podError) {
                            return of({
                              status: DeploymentStatus.PodFailed,
                              podName: acc.podError.metadata?.name!,
                              reasons: extractPodContainersErrors(acc.podError),
                            })
                          } else {
                            podsSuccess = true
                            if (deploymentSuccess) {
                              return of({
                                status: DeploymentStatus.Succees,
                              })
                            } else {
                              return EMPTY
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
                      replicateSetNameWithTimeout: updatedDeploymentReplicaSet.metadata?.name!,
                    })
                  case DeploymentStatus.Succees: {
                    deploymentSuccess = true
                    if (failDeplomentOnPodError) {
                      if (podsSuccess) {
                        return of({
                          status: DeploymentStatus.Succees,
                        })
                      } else {
                        return EMPTY
                      }
                    } else {
                      return of({
                        status: DeploymentStatus.Succees,
                      })
                    }
                  }
                }
              }),
            )
          }
        }
      }),
    ),
  )
}

// implementation details:
// 1. only if we edit the deployment.spec.metadata, k8s will create new deployment automatically and create new replicaSet.
// 2. from (1) we learn that there can be at most one replcaSet with the same `deployment.spec?.template`.
// 3. there is an edge case which may contain more than one replicaSet with same `deployment.spec?.template` but it is covered
//    because we use the same algorithm as kubectl. more info:
//    https://github.com/kubernetes/kubernetes/blob/9e5fcc49ec568f222a5274f443903d89fec3e591/pkg/controller/deployment/util/deployment_util.go#L649
async function findReplicaSetOfDeployment({
  k8sNamesapce,
  deployment,
  deploymentApi,
}: {
  deployment: k8s.V1Deployment
  k8sNamesapce: string
  deploymentApi: k8s.AppsV1Api
}): Promise<k8s.V1ReplicaSet> {
  const replicaSets = await deploymentApi.listNamespacedReplicaSet(k8sNamesapce).then(
    r => r.body.items,
    e => Promise.reject(new Error(`failed to change deployment image. error: ${JSON.stringify(e.response, null, 2)}`)),
  )

  const replicaSet = replicaSets
    // why we sort: https://github.com/kubernetes/kubernetes/blob/9e5fcc49ec568f222a5274f443903d89fec3e591/pkg/controller/deployment/util/deployment_util.go#L646
    .sort(
      // [1,5,3] -> [5,3,1]
      (a, b) => b.metadata?.creationTimestamp?.getTime()! - a.metadata?.creationTimestamp?.getTime()!,
    )
    .find(replicaSet => {
      // how to find the newest deployment's replicaSet:
      // https://github.com/kubernetes/kubernetes/blob/cea1d4e20b4a7886d8ff65f34c6d4f95efcb4742/staging/src/k8s.io/api/apps/v1beta1/types.go#L403
      const withoutPodHashLabel = _.omit(replicaSet, ['spec.template.metadata.labels.pod-template-hash'])
      return _.isEqual(
        // it doesn't work without parse+strigify, maybe there is some hidden props which are not present when trying to debug it with console.log
        JSON.parse(JSON.stringify(deployment.spec?.template)),
        JSON.parse(JSON.stringify(withoutPodHashLabel.spec?.template)),
      )
    })

  if (!replicaSet) {
    throw new Error(`could not find replicaSet of deployment: "${deployment.metadata?.name}"`)
  }
  return replicaSet
}

// NOTE: this function is heavily counting on the fact that there is at most one deployment at any given time
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
  isTestMode,
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
  isTestMode: boolean
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

  const deploymentResult = await waitForDeploymentResult({
    reDeploymentResult,
    k8sNamesapce,
    log,
    failDeplomentOnPodError,
    kc,
    deploymentApi,
    isTestMode,
  })

  return processDeploymentResult({
    reDeploymentResult,
    k8sNamesapce,
    newFullImageName,
    deploymentResult,
    log,
  })
}
