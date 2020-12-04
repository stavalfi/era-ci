import { createArtifactStepConstrain } from '@tahini/core'
import { ConstrainResult, ExecutionStatus, Status } from '@tahini/utils'
import { DockerPublishConfiguration } from '../types'
import { getVersionCacheKey, isDockerVersionAlreadyPublished } from '../utils'

export const skipIfImageTagAlreadyPublishedConstrain = createArtifactStepConstrain<
  void,
  void,
  DockerPublishConfiguration
>({
  constrainName: 'skip-if-image-tag-already-published-constrain',
  constrain: async ({ currentArtifact, stepConfigurations, immutableCache, repoPath, log }) => {
    const dockerVersionResult = await immutableCache.get(
      getVersionCacheKey({ artifactHash: currentArtifact.data.artifact.packageHash }),
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

    if (!dockerVersionResult) {
      return {
        constrainResult: ConstrainResult.shouldRun,
        artifactStepResult: { errors: [], notes: [] },
      }
    }

    if (
      await isDockerVersionAlreadyPublished({
        dockerRegistry: stepConfigurations.registry,
        registryAuth: stepConfigurations.registryAuth,
        packageName: currentArtifact.data.artifact.packageJson.name,
        imageTag: dockerVersionResult.value,
        dockerOrganizationName: stepConfigurations.dockerOrganizationName,
        repoPath,
        log,
      })
    ) {
      return {
        constrainResult: ConstrainResult.shouldSkip,
        artifactStepResult: {
          errors: [],
          notes: [
            `this package was already published in flow: "${dockerVersionResult.flowId}" with the same content as version: ${dockerVersionResult.value}`,
          ],
          executionStatus: ExecutionStatus.aborted,
          status: Status.skippedAsPassed,
        },
      }
    }

    return {
      constrainResult: ConstrainResult.ignoreThisConstrain,
      artifactStepResult: { errors: [], notes: [] },
    }
  },
})
