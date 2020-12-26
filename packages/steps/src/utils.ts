import { TaskQueueBase, UserReturnValue, UserRunStepOptions } from '@tahini/core'
import { addTagToRemoteImage, listTags } from '@tahini/image-registry-client'
import { Artifact, buildFullDockerImageName, ExecutionStatus, Node, Status } from '@tahini/utils'
import { DockerPublishConfiguration } from './types'

export async function chooseTagAndPublish<
  TaskQueue extends TaskQueueBase<unknown>,
  StepConfigurations extends DockerPublishConfiguration
>(
  options: UserRunStepOptions<TaskQueue, StepConfigurations> & {
    artifact: Node<{ artifact: Artifact }>
    publish: (tag: string) => Promise<UserReturnValue>
  },
): Promise<UserReturnValue> {
  const toHashTag = (artifactHash: string): string => `artifact-hash-${artifactHash}`

  const tags = await listTags({
    registry: options.stepConfigurations.registry,
    auth: options.stepConfigurations.registryAuth,
    dockerOrg: options.stepConfigurations.dockerOrganizationName,
    repo: options.artifact.data.artifact.packageJson.name,
  })
  const didHashPublished = tags.some(tag => tag === options.artifact.data.artifact.packageHash)

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
        notes: [
          `artifact already published: "${fullImageNameWithTag(
            toHashTag(options.artifact.data.artifact.packageHash),
          )}"`,
        ],
        returnValue: fullImageNameWithTag(toHashTag(options.artifact.data.artifact.packageHash)),
      }
    } else {
      return options.publish(toHashTag(options.artifact.data.artifact.packageHash))
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
      await addTagToRemoteImage({
        registry: options.stepConfigurations.registry,
        auth: options.stepConfigurations.registryAuth,
        dockerOrg: options.stepConfigurations.dockerOrganizationName,
        repo: options.artifact.data.artifact.packageJson.name,
        fromTag: toHashTag(options.artifact.data.artifact.packageHash),
        toTag: newTag,
      })
      artifactStepResult = {
        executionStatus: ExecutionStatus.aborted,
        status: Status.skippedAsPassed,
        errors: [],
        notes: [`artifact already published: "${fullImageNameWithTag(newTag)}"`],
        returnValue: fullImageNameWithTag(newTag),
      }
    } else {
      artifactStepResult = await options.publish(newTag)
    }
    if (artifactStepResult.status === Status.passed || artifactStepResult.status === Status.skippedAsPassed) {
      await options.immutableCache.set({
        key: cacheKey,
        value: newTag,
        ttl: options.immutableCache.ttls.ArtifactStepResult,
      })
    }
    return artifactStepResult
  }
}
