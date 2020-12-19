import { skipIfStepIsDisabledConstrain } from '@tahini/constrains'
import { ConstrainResultType, createConstrain, createStepExperimental } from '@tahini/core'
import { LocalSequentalTaskQueue } from '@tahini/task-queues'
import { Artifact, execaCommand, ExecutionStatus, getPackageTargetType, Node, Status, TargetType } from '@tahini/utils'
import { skipIfArtifactStepResultMissingOrFailedInCacheConstrain } from '@tahini/constrains'
import { createFile } from 'create-folder-structure'
import { fullImageNameCacheKey } from './utils'

export type K8sGcloudDeploymentConfiguration = {
  isStepEnabled: boolean
  gcloudProjectId: string
  k8sClusterTokenBase64: string
  k8sClusterName: string
  k8sClusterZoneName: string
  artifactNameToDeploymentName: (options: { artifactName: string }) => string
  artifactNameToContainerName: (options: { artifactName: string }) => string
}

const customConstrain = createConstrain<
  { currentArtifact: Node<{ artifact: Artifact }> },
  { currentArtifact: Node<{ artifact: Artifact }> },
  K8sGcloudDeploymentConfiguration
>({
  constrainName: 'custom-constrain',
  constrain: async ({ constrainConfigurations: { currentArtifact } }) => {
    const targetType = await getPackageTargetType(
      currentArtifact.data.artifact.packagePath,
      currentArtifact.data.artifact.packageJson,
    )
    if (targetType !== TargetType.docker) {
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

export const k8sGcloudDeployment = createStepExperimental<LocalSequentalTaskQueue, K8sGcloudDeploymentConfiguration>({
  stepName: 'k8s-gcloud-deployment',
  taskQueueClass: LocalSequentalTaskQueue,
  run: ({ stepConfigurations, repoPath, log, immutableCache }) => ({
    globalConstrains: [skipIfStepIsDisabledConstrain()],
    artifactConstrains: [
      artifact =>
        skipIfArtifactStepResultMissingOrFailedInCacheConstrain({
          currentArtifact: artifact,
          stepNameToSearchInCache: 'docker-publish',
          skipAsFailedIfStepResultNotFoundInCache: true,
          skipAsPassedIfStepNotExists: false,
        }),
      artifact => customConstrain({ currentArtifact: artifact }),
    ],
    onBeforeArtifacts: async () => {
      const { stdout: keyContent } = await execaCommand(
        `echo ${stepConfigurations.k8sClusterTokenBase64} | base64 -d`,
        {
          stdio: 'pipe',
          shell: true,
          cwd: repoPath,
          log,
        },
      )
      const k8sKeyPath = await createFile(keyContent)
      await execaCommand(
        `gcloud auth activate-service-account --key-file=${k8sKeyPath} --project ${stepConfigurations.gcloudProjectId}`,
        {
          stdio: 'pipe',
          shell: true,
          cwd: repoPath,
          log,
        },
      )
      await execaCommand(
        `gcloud container clusters get-credentials ${stepConfigurations.k8sClusterName} --zone ${stepConfigurations.k8sClusterZoneName} --project ${stepConfigurations.gcloudProjectId}`,
        {
          stdio: 'pipe',
          shell: true,
          cwd: repoPath,
          log,
        },
      )
    },
    onArtifact: async ({ artifact }) => {
      const artifactName = artifact.data.artifact.packageJson.name
      const deploymentName = stepConfigurations.artifactNameToDeploymentName({ artifactName })
      const containerName = stepConfigurations.artifactNameToContainerName({ artifactName })

      const fullImageName = await immutableCache.get(
        fullImageNameCacheKey({ packageHash: artifact.data.artifact.packageHash }),
        r => {
          if (typeof r === 'string') {
            return r
          } else {
            throw new Error(
              `invalid value in cache. expected the type to be: string, acutal-type: ${typeof r}. actual value: ${r}`,
            )
          }
        },
      )

      if (!fullImageName) {
        throw new Error(`can't find full-image-name with the new version in the cache. deployment is aborted`)
      }

      await execaCommand(`kubectl set image deployment/${deploymentName} ${containerName}=${fullImageName} --record`, {
        stdio: 'inherit',
        cwd: repoPath,
        log,
      })
    },
  }),
})
