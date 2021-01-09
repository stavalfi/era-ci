import { TaskQueueBase, UserReturnValue, UserRunStepOptions } from '@era-ci/core'
import { addTagToRemoteImage, listTags } from '@era-ci/image-registry-client'
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TaskQueue extends TaskQueueBase<any, any>,
  StepConfigurations extends DockerPublishConfiguration
>(
  options: UserRunStepOptions<TaskQueue, StepConfigurations> & {
    artifact: Node<{ artifact: Artifact }>
    publish: (tag: string) => Promise<UserReturnValue>
  },
): Promise<UserReturnValue> {
  const hashTag = `artifact-hash-${options.artifact.data.artifact.packageHash}`

  const tags = await listTags({
    registry: options.stepConfigurations.registry,
    auth: options.stepConfigurations.registryAuth,
    dockerOrg: options.stepConfigurations.dockerOrganizationName,
    repo: distructPackageJsonName(options.artifact.data.artifact.packageJson.name).name,
  })
  const didHashPublished = tags.some(tag => tag === hashTag)

  const fullImageNameWithTag = (tag: string): string =>
    buildFullDockerImageName({
      dockerOrganizationName: options.stepConfigurations.dockerOrganizationName,
      dockerRegistry: options.stepConfigurations.registry,
      imageName: options.artifact.data.artifact.packageJson.name,
      imageTag: tag,
    })

  if (options.stepConfigurations.buildAndPushOnlyTempVersion) {
    if (didHashPublished) {
      return {
        executionStatus: ExecutionStatus.aborted,
        status: Status.skippedAsPassed,
        errors: [],
        notes: [`artifact already published: "${fullImageNameWithTag(hashTag)}"`],
        returnValue: fullImageNameWithTag(hashTag),
      }
    } else {
      return options.publish(hashTag)
    }
  } else {
    const cacheKey = `${options.artifact.data.artifact.packageHash}-next-tag`
    const newTagFromCache = await options.immutableCache.get(cacheKey, r => {
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

    let artifactStepResult: UserReturnValue
    const newTag = options.gitRepoInfo.commit
    if (didHashPublished) {
      artifactStepResult = {
        executionStatus: ExecutionStatus.aborted,
        status: Status.skippedAsPassed,
        errors: [],
        notes: [`artifact already published: "${fullImageNameWithTag(newTag)}"`],
        returnValue: fullImageNameWithTag(newTag),
      }
    } else {
      artifactStepResult = await options.publish(hashTag)
    }
    if (artifactStepResult.status === Status.passed || artifactStepResult.status === Status.skippedAsPassed) {
      await addTagToRemoteImage({
        registry: options.stepConfigurations.registry,
        auth: options.stepConfigurations.registryAuth,
        dockerOrg: options.stepConfigurations.dockerOrganizationName,
        repo: distructPackageJsonName(options.artifact.data.artifact.packageJson.name).name,
        fromTag: hashTag,
        toTag: newTag,
      })
      await options.immutableCache.set({
        key: cacheKey,
        value: newTag,
        ttl: options.immutableCache.ttls.ArtifactStepResult,
      })
    }
    return artifactStepResult
  }
}
