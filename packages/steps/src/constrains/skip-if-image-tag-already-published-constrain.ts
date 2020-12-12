import { ConstrainResultType, createConstrain } from '@tahini/core'
import { Artifact, ExecutionStatus, Node, Status } from '@tahini/utils'
import { getVersionCacheKey, isDockerVersionAlreadyPublished } from '../utils'

export const skipIfImageTagAlreadyPublishedConstrain = createConstrain<
  { currentArtifact: Node<{ artifact: Artifact }> },
  { currentArtifact: Node<{ artifact: Artifact }> },
  {
    isStepEnabled: boolean
    registry: string
    registryAuth?: {
      username: string
      token: string
    }
    dockerOrganizationName: string
  }
>({
  constrainName: 'skip-if-image-tag-already-published-constrain',
  constrain: async ({
    stepConfigurations,
    immutableCache,
    repoPath,
    log,
    constrainConfigurations: { currentArtifact },
  }) => {
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
        resultType: ConstrainResultType.ignoreThisConstrain,
        result: { errors: [], notes: [] },
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
        resultType: ConstrainResultType.shouldSkip,
        result: {
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
      resultType: ConstrainResultType.ignoreThisConstrain,
      result: { errors: [], notes: [] },
    }
  },
})
