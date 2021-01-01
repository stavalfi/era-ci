import {
  skipIfArtifactStepResultMissingOrFailedInCacheConstrain,
  skipIfArtifactTargetTypeNotSupportedConstrain,
  skipIfStepIsDisabledConstrain,
} from '@era-ci/constrains'
import { createStepExperimental, toTaskEvent$, UserReturnValue, UserRunStepOptions } from '@era-ci/core'
import { QuayBuildsTaskQueue } from '@era-ci/task-queues'
import { Artifact, buildFullDockerImageName, ExecutionStatus, Node, Status, TargetType } from '@era-ci/utils'
import path from 'path'
import { last } from 'rxjs/operators'
import { QuayDockerPublishConfiguration } from './types'
import { chooseTagAndPublish } from './utils'

async function buildAndPublishArtifact({
  stepConfigurations,
  repoPath,
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
        returnValue: [Status.passed, Status.skippedAsPassed].includes(taskResult.taskResult.status)
          ? fullImageNameNewVersion
          : undefined,
      }
    }
  }
}

export const quayDockerPublish = createStepExperimental<QuayBuildsTaskQueue, QuayDockerPublishConfiguration>({
  stepName: 'quay-docker-publish',
  stepGroup: 'docker-publish',
  taskQueueClass: QuayBuildsTaskQueue,
  normalizeStepConfigurations: async (config, options) => ({
    ...config,
    buildAndPushOnlyTempVersion:
      'BUILD_AND_PUSH_ONLY_TEMP_VERSION' in options.processEnv
        ? Boolean(options.processEnv['BUILD_AND_PUSH_ONLY_TEMP_VERSION'])
        : config.buildAndPushOnlyTempVersion,
  }),
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
