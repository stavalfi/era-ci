import { TaskQueueBase, UserReturnValue, UserRunStepOptions } from '@era-ci/core'
import { listTags } from '@era-ci/image-registry-client'
import {
  Artifact,
  buildFullDockerImageName,
  distructPackageJsonName,
  ExecutionStatus,
  Node,
  Status,
} from '@era-ci/utils'
import { DockerPublishConfiguration } from './types'

export async function chooseTagAndPublish<
  TaskQueue extends TaskQueueBase<any, any>,
  StepConfigurations extends DockerPublishConfiguration
>(
  options: UserRunStepOptions<TaskQueue, StepConfigurations> & {
    artifact: Node<{ artifact: Artifact }>
    publish: (tag: string) => Promise<UserReturnValue>
  },
): Promise<UserReturnValue> {
  const tags = await listTags({
    registry: options.stepConfigurations.registry,
    auth: options.stepConfigurations.registryAuth,
    dockerOrg: options.stepConfigurations.dockerOrganizationName,
    repo: distructPackageJsonName(options.artifact.data.artifact.packageJson.name).name,
  })

  const fullImageNameWithTag = (tag: string): string =>
    buildFullDockerImageName({
      dockerOrganizationName: options.stepConfigurations.dockerOrganizationName,
      dockerRegistry: options.stepConfigurations.registry,
      imageName: options.artifact.data.artifact.packageJson.name,
      imageTag: tag,
    })

  const cacheKey = `${options.artifact.data.artifact.packageHash}-next-tag`
  const newTagFromCache = await options.immutableCache.get({
    key: cacheKey,
    isBuffer: true,
    mapper: r => {
      if (typeof r !== 'string') {
        throw new Error(
          `bad value returned from redis-immutable-cache. expected image-tag, received: "${JSON.stringify(
            r,
            null,
            2,
          )}"`,
        )
      } else {
        return r
      }
    },
  })

  if (newTagFromCache && tags.includes(newTagFromCache.value)) {
    return {
      executionStatus: ExecutionStatus.aborted,
      status: Status.skippedAsPassed,
      errors: [],
      notes: [
        `artifact already published: "${fullImageNameWithTag(newTagFromCache.value)}" in flow: "${
          newTagFromCache.flowId
        }"`,
      ],
      returnValue: fullImageNameWithTag(newTagFromCache.value),
    }
  }

  const newTag = options.gitRepoInfo.commit.slice(0, 8)
  const artifactStepResult = await options.publish(newTag)

  if (artifactStepResult.status === Status.passed || artifactStepResult.status === Status.skippedAsPassed) {
    await options.immutableCache.set({
      key: cacheKey,
      value: newTag,
      asBuffer: true,
      ttl: options.immutableCache.ttls.ArtifactStepResult,
    })
  }

  return artifactStepResult
}
