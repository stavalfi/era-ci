import {
  skipAsFailedIfArtifactStepResultFailedInCacheConstrain,
  skipAsPassedIfArtifactTargetTypeNotSupportedConstrain,
  skipAsPassedIfStepIsDisabledConstrain,
} from '@era-ci/constrains'
import { createStep, toTaskEvent$, UserReturnValue, UserRunStepOptions } from '@era-ci/core'
import { QuayBuildsTaskQueue } from '@era-ci/task-queues'
import {
  Artifact,
  buildFullDockerImageName,
  distructPackageJsonName,
  ExecutionStatus,
  Node,
  Status,
  TargetType,
} from '@era-ci/utils'
import path from 'path'
import { lastValueFrom } from 'rxjs'
import { QuayDockerPublishConfiguration } from './types'
import { chooseTagAndPublish } from './utils'

async function buildAndPublishArtifact({
  stepConfigurations,
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
      relativeContextPath: '',
      relativeDockerfilePath: path.join(currentArtifact.data.artifact.relativePackagePath, 'Dockerfile'),
      imageTags: [tag],
      repoName: distructPackageJsonName(currentArtifact.data.artifact.packageJson.name).name,
      visibility: stepConfigurations.imagesVisibility,
    },
  ])

  const taskResult = await lastValueFrom(
    toTaskEvent$(task.taskId, {
      eventEmitter: taskQueue.eventEmitter,
      throwOnTaskNotPassed: false,
    }),
  )

  switch (taskResult.taskExecutionStatus) {
    case ExecutionStatus.scheduled:
    case ExecutionStatus.running:
      throw new Error(`we can't be here15`)
    case ExecutionStatus.aborted:
      return taskResult.taskResult
    case ExecutionStatus.done: {
      const notes = [...taskResult.taskResult.notes]

      const fullImageNameNewVersion = buildFullDockerImageName({
        dockerOrganizationName: stepConfigurations.dockerOrganizationName,
        dockerRegistry: stepConfigurations.dockerRegistry,
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
        returnValue: [Status.passed, Status.skippedAsPassed].includes(taskResult.taskResult.status)
          ? fullImageNameNewVersion
          : undefined,
      }
    }
  }
}

export const quayDockerPublish = createStep<QuayBuildsTaskQueue, QuayDockerPublishConfiguration>({
  stepName: 'quay-docker-publish',
  stepGroup: 'docker-publish',
  taskQueueClass: QuayBuildsTaskQueue,
  run: async options => {
    return {
      globalConstrains: [skipAsPassedIfStepIsDisabledConstrain()],
      waitUntilArtifactParentsFinishedParentSteps: options.stepConfigurations.imageInstallArtifactsFromNpmRegistry,
      artifactConstrains: [
        artifact =>
          skipAsPassedIfArtifactTargetTypeNotSupportedConstrain({
            currentArtifact: artifact,
            supportedTargetType: TargetType.docker,
          }),
        artifact =>
          skipAsFailedIfArtifactStepResultFailedInCacheConstrain({
            currentArtifact: artifact,
            stepNameToSearchInCache: 'build',

            skipAsPassedIfStepNotExists: true,
          }),
        artifact =>
          skipAsFailedIfArtifactStepResultFailedInCacheConstrain({
            currentArtifact: artifact,
            stepNameToSearchInCache: 'test',

            skipAsPassedIfStepNotExists: true,
          }),
      ],
      onArtifact: async ({ artifact }) =>
        chooseTagAndPublish({
          ...options,
          artifact,
          publish: tag =>
            buildAndPublishArtifact({
              ...options,
              currentArtifact: artifact,
              tag,
            }),
        }),
    }
  },
})
