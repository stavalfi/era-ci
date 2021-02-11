import {
  skipIfArtifactStepResultMissingOrFailedInCacheConstrain,
  skipIfStepIsDisabledConstrain,
} from '@era-ci/constrains'
import { ConstrainResultType, createConstrain, createStep, getReturnValue } from '@era-ci/core'
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

enum DeploymentStatus {
  NotReadYet = 'NotReadYet',
  ThereWasAddtionalDeployment = 'there-was-addtional-deployment',
  Timeout = 'timeout',
  Succees = 'success',
  deleted = 'deployment-deleted',
  created = 'deployment-created',
}

function getUpdatedDeploymentStatus({
  reDeploymentResult,
  updatedDeployment,
}: {
  reDeploymentResult: k8s.V1Deployment
  updatedDeployment: k8s.V1Deployment
}):
  | {
      status: DeploymentStatus.Succees | DeploymentStatus.Timeout | DeploymentStatus.NotReadYet
    }
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
      status: DeploymentStatus.NotReadYet,
    }
  }

  if (currentGeneration > generationToTrackOn) {
    return { status: DeploymentStatus.ThereWasAddtionalDeployment, newDeploymentGeneration: currentGeneration }
  }

  // the following is a copy-paste from GO to NodeJS from kubectl source code to understand if the deployment passed or failed:
  // https://github.com/kubernetes/kubectl/blob/a2d36ec6d62f756e72fb3a5f49ed0f720ad0fe83/pkg/polymorphichelpers/rollout_status.go#L75'

  if (currentGeneration === currentObservedGeneration) {
    const progressingCondition = updatedDeployment.status?.conditions?.find(c => c.type === 'Progressing')
    // https://github.com/uswitch/kubernetes-autoscaler/blob/master/cluster-autoscaler/vendor/k8s.io/kubernetes/pkg/kubectl/util/deployment/deployment.go#L52
    if (progressingCondition?.reason === 'ProgressDeadlineExceeded') {
      return { status: DeploymentStatus.Timeout }
    }
    if (
      updatedDeployment.spec?.replicas !== undefined &&
      updatedDeployment.status?.replicas !== undefined &&
      updatedDeployment.status.updatedReplicas !== undefined &&
      updatedDeployment.status.replicas === updatedDeployment.spec.replicas &&
      updatedDeployment.status.replicas === updatedDeployment.status.updatedReplicas &&
      updatedDeployment.status.replicas === updatedDeployment.status.availableReplicas
    ) {
      return { status: DeploymentStatus.Succees }
    }
  }

  return { status: DeploymentStatus.NotReadYet }
}

const deploy = async ({
  changeCause,
  containerName,
  deploymentApi,
  newFullImageName,
  deploymentName,
  k8sNamesapce,
}: {
  changeCause: string
  deploymentName: string
  deploymentApi: k8s.AppsV1Api
  containerName: string
  newFullImageName: string
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
                image: newFullImageName,
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

export type K8sResource =
  | k8s.V1Service
  | k8s.V1Deployment
  | k8s.V1beta1CronJob
  | k8s.V1Namespace
  | k8s.V1Pod
  | k8s.V1Role
  | k8s.V1RoleBinding
  | k8s.V1ClusterRole
  | k8s.V1ClusterRoleBinding

const waitDeploymentReady = async ({
  kc,
  k8sNamesapce,
  reDeploymentResult,
}: {
  kc: k8s.KubeConfig
  k8sNamesapce: string
  reDeploymentResult: k8s.V1Deployment
}) => {
  // more info: https://kubernetes.io/docs/reference/using-api/api-concepts/#efficient-detection-of-changes
  // const { resourceVersion } = deployment.metadata ?? {}
  // if (!resourceVersion) {
  //   throw new Error(`can't track on changes of the deployment because resourceVersion is missing`)
  // }
  const watch = new k8s.Watch(kc)
  return new Promise<
    | {
        status:
          | DeploymentStatus.Succees
          | DeploymentStatus.Timeout
          | DeploymentStatus.created
          | DeploymentStatus.deleted
      }
    | { status: DeploymentStatus.ThereWasAddtionalDeployment; newDeploymentGeneration: number }
  >((res, rej) => {
    let watchResponse: { abort: () => void }
    const requestedDeploymentRevision = reDeploymentResult.metadata?.annotations?.['deployment.kubernetes.io/revision']
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
        (type: string, updatedDeployment: k8s.V1Deployment) => {
          if (updatedDeployment.metadata?.name !== reDeploymentResult.metadata?.name) {
            return
          }
          switch (type) {
            case 'DELETED':
              watchResponse.abort()
              res({ status: DeploymentStatus.deleted })
              break
            case 'ADDED':
              watchResponse.abort()
              res({ status: DeploymentStatus.created })
              break
            case 'MODIFIED': {
              const result = getUpdatedDeploymentStatus({
                reDeploymentResult,
                updatedDeployment,
              })
              switch (result.status) {
                case DeploymentStatus.NotReadYet:
                  break
                case DeploymentStatus.ThereWasAddtionalDeployment:
                  watchResponse.abort()
                  res({
                    status: result.status,
                    newDeploymentGeneration: result.newDeploymentGeneration,
                  })
                  break
                case DeploymentStatus.Succees:
                case DeploymentStatus.Timeout:
                  watchResponse.abort()
                  res({
                    status: result.status,
                  })
              }
            }
          }
        },
        function done() {
          rej(
            new Error(
              `k8s-watch has ended but we didn't recognize that the deployment "${reDeploymentResult.metadata?.name}" passed`,
            ),
          )
        },
        function error(error: unknown) {
          rej(error)
        },
      )
      .then(r => {
        watchResponse = r
      })
  })
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
  run: async ({ stepConfigurations, getState, steps, artifacts }) => {
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

        const reDeploymentResult = await deploy({
          changeCause: `era-ci automation - to image (image-name:<git-revision>): ${newFullImageName}`,
          containerName,
          newFullImageName,
          deploymentApi,
          deploymentName,
          k8sNamesapce: stepConfigurations.k8sNamesapce,
        })

        const result = await waitDeploymentReady({
          reDeploymentResult,
          k8sNamesapce: stepConfigurations.k8sNamesapce,
          kc,
        })

        switch (result.status) {
          case DeploymentStatus.Succees:
            return
          case DeploymentStatus.ThereWasAddtionalDeployment:
            return {
              executionStatus: ExecutionStatus.done,
              status: Status.failed,
              notes: [
                `there was a new deployment while waiting until the reuqets deployment will be ready ready.\
                 requested-deployment-generation: "${reDeploymentResult.metadata?.generation}". new-deployment-generation: "${result.newDeploymentGeneration}".\
                 for more help - run: "kubectl rollout history -n ${stepConfigurations.k8sNamesapce} deploy ${reDeploymentResult.metadata?.name}"`,
              ],
            }
          case DeploymentStatus.created:
            return {
              executionStatus: ExecutionStatus.done,
              status: Status.failed,
              notes: [
                `the deployment was deleted and recreated while the CI was running. please check it out and run the CI again`,
              ],
            }
          case DeploymentStatus.deleted:
            return {
              executionStatus: ExecutionStatus.done,
              status: Status.failed,
              notes: [`the deployment was deleted`],
            }
          case DeploymentStatus.Timeout:
            return {
              executionStatus: ExecutionStatus.done,
              status: Status.failed,
              notes: [
                `deployment timeout. run: "kubectl describe deploy ${reDeploymentResult.metadata?.name}". look for odd behavior`,
              ],
            }
        }
      },
    }
  },
})
