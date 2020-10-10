import { createFile } from 'create-folder-structure'
import { skipIfArtifactStepResultMissingOrFailedInCacheConstrain } from '../artifact-step-constrains'
import { createArtifactStepConstrain } from '../create-artifact-step-constrain'
import { createStep, RunStrategy } from '../create-step'
import { skipIfStepIsDisabledConstrain } from '../step-constrains'
import { ConstrainResult, ExecutionStatus, Status } from '../types'
import { execaCommand } from '../utils'
import { getPackageTargetType, TargetType } from './utils'

export type K8sGcloudDeploymentConfiguration = {
  isStepEnabled: boolean
  gcloudProjectId: string
  k8sClusterTokenBase64: string
  k8sClusterName: string
  k8sClusterZoneName: string
  artifactNameToDeploymentName: (artifactName: string) => string
  artifactNameToContainerName: (artifactName: string) => string
  fullImageNameCacheKey: (options: { packageHash: string }) => string
}

const customConstrain = createArtifactStepConstrain<void, void, K8sGcloudDeploymentConfiguration>({
  constrainName: 'custom-constrain',
  constrain: async ({ currentArtifact }) => {
    const targetType = await getPackageTargetType(
      currentArtifact.data.artifact.packagePath,
      currentArtifact.data.artifact.packageJson,
    )
    if (targetType !== TargetType.docker) {
      return {
        constrainResult: ConstrainResult.shouldSkip,
        artifactStepResult: {
          errors: [],
          notes: [],
          executionStatus: ExecutionStatus.aborted,
          status: Status.skippedAsPassed,
        },
      }
    }

    return {
      constrainResult: ConstrainResult.shouldRun,
      artifactStepResult: { errors: [], notes: [] },
    }
  },
})

export const k8sGcloudDeployment = createStep<K8sGcloudDeploymentConfiguration>({
  stepName: 'k8s-gcloud-deployment',
  constrains: {
    onArtifact: [
      skipIfArtifactStepResultMissingOrFailedInCacheConstrain({
        stepNameToSearchInCache: 'docker-publish',
        skipAsFailedIfStepNotFoundInCache: true,
      }),
      customConstrain(),
    ],
    onStep: [skipIfStepIsDisabledConstrain()],
  },
  run: {
    runStrategy: RunStrategy.perArtifact,
    beforeAll: async ({ stepConfigurations, repoPath, log }) => {
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
    runStepOnArtifact: async ({ currentArtifact, stepConfigurations, repoPath, log, cache }) => {
      const packageName = currentArtifact.data.artifact.packageJson.name
      const deploymentName = stepConfigurations.artifactNameToDeploymentName(packageName)
      const containerName = stepConfigurations.artifactNameToContainerName(packageName)

      const fullImageName = await cache.get(
        stepConfigurations.fullImageNameCacheKey({ packageHash: currentArtifact.data.artifact.packageHash }),
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

      return { errors: [], notes: [], executionStatus: ExecutionStatus.done, status: Status.passed }
    },
  },
})
