import {
  skipIfArtifactStepResultMissingOrFailedInCacheConstrain,
  skipIfArtifactTargetTypeNotSupportedConstrain,
  skipIfStepIsDisabledConstrain,
} from '@tahini/constrains'
import { createStepExperimental, toTaskEvent$, UserReturnValue, UserRunStepOptions } from '@tahini/core'
import { addTagToRemoteImage, listTags } from '@tahini/image-registry-client'
import { QuayBuildsTaskQueue } from '@tahini/task-queues'
import {
  Artifact,
  buildFullDockerImageName,
  calculateNewVersion,
  ExecutionStatus,
  Node,
  Status,
  TargetType,
} from '@tahini/utils'
import path from 'path'
import { last } from 'rxjs/operators'
import { QuayDockerPublishConfiguration } from './types'

async function buildAndPublishArtifact({
  stepConfigurations,
  repoPath,
  immutableCache,
  currentArtifact,
  taskQueue,
  tag,
}: UserRunStepOptions<QuayBuildsTaskQueue, QuayDockerPublishConfiguration> & {
  currentArtifact: Node<{ artifact: Artifact }>
  tag: string
}): Promise<UserReturnValue> {
  const [task] = taskQueue.addTasksToQueue([
    {
      packageName: currentArtifact.data.artifact.packageJson.name,
      relativeContextPath: '/',
      relativeDockerfilePath: path.relative(
        repoPath,
        path.join(currentArtifact.data.artifact.packagePath, 'Dockerfile'),
      ),
      imageTags: [tag],
      taskTimeoutMs: stepConfigurations.dockerfileBuildTimeoutMs,
      repoName: currentArtifact.data.artifact.packageJson.name,
      visibility: stepConfigurations.imagesVisibility,
    },
  ])

  const taskResult = await toTaskEvent$(task.taskId, {
    eventEmitter: taskQueue.eventEmitter,
    throwOnTaskNotPassed: false,
  })
    .pipe(last())
    .toPromise()

  switch (taskResult.taskExecutionStatus) {
    case ExecutionStatus.scheduled:
    case ExecutionStatus.running:
      throw new Error(`we can't be here15`)
    case ExecutionStatus.aborted:
      return {
        executionStatus: ExecutionStatus.aborted,
        errors: taskResult.taskResult.errors,
        notes: taskResult.taskResult.notes,
        status: taskResult.taskResult.status,
      }
    case ExecutionStatus.done: {
      const notes = [...taskResult.taskResult.notes]

      const fullImageNameNewVersion = buildFullDockerImageName({
        dockerOrganizationName: stepConfigurations.dockerOrganizationName,
        dockerRegistry: stepConfigurations.registry,
        imageName: currentArtifact.data.artifact.packageJson.name,
        imageTag: tag,
      })

      if (taskResult.taskResult.status === Status.passed) {
        notes.push(`published docker-image: ${fullImageNameNewVersion}`)
      }

      return {
        executionStatus: ExecutionStatus.done,
        errors: taskResult.taskResult.errors,
        notes,
        status: taskResult.taskResult.status,
        returnValue: taskResult.taskResult.status === Status.passed ? fullImageNameNewVersion : undefined,
      }
    }
  }
}
export const quayDockerPublish = createStepExperimental<QuayBuildsTaskQueue, QuayDockerPublishConfiguration>({
  stepName: 'quay-docker-publish',
  stepGroup: 'docker-publish',
  taskQueueClass: QuayBuildsTaskQueue,
  run: options => {
    return {
      globalConstrains: [skipIfStepIsDisabledConstrain()],
      waitUntilArtifactParentsFinishedParentSteps: options.stepConfigurations.imageInstallArtifactsFromNpmRegistry,
      artifactConstrains: [
        artifact =>
          skipIfArtifactTargetTypeNotSupportedConstrain({
            currentArtifact: artifact,
            supportedTargetType: TargetType.docker,
          }),
        artifact =>
          skipIfArtifactStepResultMissingOrFailedInCacheConstrain({
            currentArtifact: artifact,
            stepNameToSearchInCache: 'build',
            skipAsFailedIfStepResultNotFoundInCache: false,
            skipAsPassedIfStepNotExists: true,
          }),
        artifact =>
          skipIfArtifactStepResultMissingOrFailedInCacheConstrain({
            currentArtifact: artifact,
            stepNameToSearchInCache: 'test',
            skipAsFailedIfStepResultNotFoundInCache: false,
            skipAsPassedIfStepNotExists: true,
          }),
      ],
      onArtifact: async ({ artifact }) => {
        const tags = await listTags({
          registry: options.stepConfigurations.registry,
          auth: options.stepConfigurations.registryAuth,
          dockerOrg: options.stepConfigurations.dockerOrganizationName,
          repo: artifact.data.artifact.packageJson.name,
        })

        const didHashPublished = tags.some(tag => tag === artifact.data.artifact.packageHash)
        const fullImageNameWithHashTag = (tag: string): string =>
          buildFullDockerImageName({
            dockerOrganizationName: options.stepConfigurations.dockerOrganizationName,
            dockerRegistry: options.stepConfigurations.registry,
            imageName: artifact.data.artifact.packageJson.name,
            imageTag: tag,
          })
        if (options.stepConfigurations.buildAndPushOnlyTempVersion) {
          if (didHashPublished) {
            return {
              executionStatus: ExecutionStatus.aborted,
              status: Status.skippedAsPassed,
              errors: [],
              notes: [`artifact already published: "${fullImageNameWithHashTag(artifact.data.artifact.packageHash)}"`],
            }
          } else {
            return buildAndPublishArtifact({
              ...options,
              currentArtifact: artifact,
              tag: artifact.data.artifact.packageHash,
            })
          }
        } else {
          const nextVersion = await options.immutableCache.get(
            `${artifact.data.artifact.packageHash}-next-semver-tag`,
            r => {
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
          )
          if (nextVersion) {
            return {
              executionStatus: ExecutionStatus.aborted,
              status: Status.skippedAsPassed,
              errors: [],
              notes: [
                `artifact already published: "${fullImageNameWithHashTag(nextVersion.value)}" in flow: "${
                  nextVersion.flowId
                }"`,
              ],
              returnValue: fullImageNameWithHashTag(nextVersion.value),
            }
          }
          let artifactStepResult: UserReturnValue
          const newTag = calculateNewVersion({
            packagePath: artifact.data.artifact.packagePath,
            packageJsonVersion: artifact.data.artifact.packageJson.version,
            allVersions: tags,
          })
          if (didHashPublished) {
            await addTagToRemoteImage({
              registry: options.stepConfigurations.registry,
              auth: options.stepConfigurations.registryAuth,
              dockerOrg: options.stepConfigurations.dockerOrganizationName,
              repo: artifact.data.artifact.packageJson.name,
              fromTag: artifact.data.artifact.packageHash,
              toTag: newTag,
            })
            artifactStepResult = {
              executionStatus: ExecutionStatus.done,
              status: Status.passed,
              errors: [],
              notes: [`artifact already published: "${fullImageNameWithHashTag(newTag)}"`],
              returnValue: fullImageNameWithHashTag(newTag),
            }
          } else {
            artifactStepResult = await buildAndPublishArtifact({
              ...options,
              currentArtifact: artifact,
              tag: newTag,
            })
          }
          await options.immutableCache.set({
            key: `${artifact.data.artifact.packageHash}-next-semver-tag`,
            value: newTag,
            ttl: options.immutableCache.ttls.ArtifactStepResult,
          })
          return artifactStepResult
        }
      },
    }
  },
})
