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
    registry: options.stepConfigurations.dockerRegistry,
    auth: options.stepConfigurations.dockerRegistryAuth,
    dockerOrg: options.stepConfigurations.dockerOrganizationName,
    repo: distructPackageJsonName(options.artifact.data.artifact.packageJson.name).name,
  })

  const fullImageNameWithTag = (tag: string): string =>
    buildFullDockerImageName({
      dockerOrganizationName: options.stepConfigurations.dockerOrganizationName,
      dockerRegistry: options.stepConfigurations.dockerRegistry,
      imageName: options.artifact.data.artifact.packageJson.name,
      imageTag: tag,
    })

  // do not change this key. other packages may use it and they don't want to depend on any package for imorting it
  const cacheKey = `image-tag-of-${options.artifact.data.artifact.packageHash}`
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
  if (tags.includes(newTag)) {
    return {
      executionStatus: ExecutionStatus.aborted,
      status: Status.skippedAsFailed,
      notes: [
        `there is already a docker-image with a tag equal to <current-git-head>. please commit your changes and try again`,
      ],
    }
  }

  const artifactStepResult = await options.publish(newTag)

  if (artifactStepResult.status === Status.passed || artifactStepResult.status === Status.skippedAsPassed) {
    await options.immutableCache.set({
      key: cacheKey,
      value: newTag,
      asBuffer: true,
      ttl: options.immutableCache.ttls.ArtifactStepResults,
    })
  }

  return artifactStepResult
}
