import {
  skipIfArtifactStepResultMissingOrFailedInCacheConstrain,
  skipIfStepIsDisabledConstrain,
} from '@era-ci/constrains'
import { ConstrainResultType, createConstrain, createStepExperimental } from '@era-ci/core'
import { LocalSequentalTaskQueue } from '@era-ci/task-queues'
import { Artifact, execaCommand, ExecutionStatus, getPackageTargetTypes, Node, Status, TargetType } from '@era-ci/utils'
import { createFile } from 'create-folder-structure'
import _ from 'lodash'

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
    const targetTypes = await getPackageTargetTypes(
      currentArtifact.data.artifact.packagePath,
      currentArtifact.data.artifact.packageJson,
    )
    if (!targetTypes.includes(TargetType.docker)) {
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
  stepGroup: 'k8s-gcloud-deployment',
  taskQueueClass: LocalSequentalTaskQueue,
  run: ({ stepConfigurations, repoPath, log, getState, steps }) => ({
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

      const fullImageName = getState().getReturnValue({
        artifactName: artifact.data.artifact.packageJson.name,
        stepGroup: 'docker-publish',
        mapper: _.identity,
      })

      log.verbose(`trying deploy docker-image: "${fullImageName}". the same `)

      await execaCommand(`kubectl set image deployment/${deploymentName} ${containerName}=${fullImageName} --record`, {
        stdio: 'inherit',
        cwd: repoPath,
        log,
      })
    },
  }),
})
