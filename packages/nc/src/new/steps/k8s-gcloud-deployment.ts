import { createFile } from 'create-folder-structure'
import { getPackageTargetType } from '../../package-info'
import { TargetType } from '../../types'
import { execaCommand } from '../../utils'
import { createStep } from '../create-step'
import { StepStatus } from '../types'

export type K8sGcloudDeploymentConfiguration = {
  shouldDeploy: boolean
  gcloudProjectId: string
  k8sClusterTokenBase64: string
  k8sClusterName: string
  k8sClusterZoneName: string
  artifactNameToDeploymentName: (artifactName: string) => string
  artifactNameToContainerName: (artifactName: string) => string
  fullImageNameCacheKey: (options: { packageHash: string }) => string
}

export const k8sGcloudDeployment = createStep<K8sGcloudDeploymentConfiguration>({
  stepName: 'k8s-gcloud-deployment',
  canRunStepOnArtifact: {
    customPredicate: async ({ currentArtifact, stepConfigurations }) => {
      if (!stepConfigurations.shouldDeploy) {
        return {
          canRun: false,
          notes: [`k8s-gcloud deployment is disabled`],
          stepStatus: StepStatus.skippedAsPassed,
        }
      }

      const targetType = await getPackageTargetType(
        currentArtifact.data.artifact.packagePath,
        currentArtifact.data.artifact.packageJson,
      )
      if (targetType !== TargetType.docker) {
        return {
          canRun: false,
          notes: [],
          stepStatus: StepStatus.skippedAsPassed,
        }
      }

      return {
        canRun: true,
        notes: [],
      }
    },
  },
  beforeAll: async ({ stepConfigurations, repoPath }) => {
    const { stdout: keyContent } = await execaCommand(`echo ${stepConfigurations.k8sClusterTokenBase64} | base64 -d`, {
      stdio: 'pipe',
      shell: true,
      cwd: repoPath,
    })
    const k8sKeyPath = await createFile(keyContent)
    await execaCommand(
      `gcloud auth activate-service-account --key-file=${k8sKeyPath} --project ${stepConfigurations.gcloudProjectId}`,
      {
        stdio: 'pipe',
        shell: true,
        cwd: repoPath,
      },
    )
    await execaCommand(
      `gcloud container clusters get-credentials ${stepConfigurations.k8sClusterName} --zone ${stepConfigurations.k8sClusterZoneName} --project ${stepConfigurations.gcloudProjectId}`,
      {
        stdio: 'pipe',
        shell: true,
        cwd: repoPath,
      },
    )
  },
  runStepOnArtifact: async ({ currentArtifact, stepConfigurations, repoPath, log, cache }) => {
    const packageName = currentArtifact.data.artifact.packageJson.name!
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
    })

    return {
      notes: [],
      status: StepStatus.passed,
    }
  },
})
