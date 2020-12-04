import {
  skipIfArtifactStepResultMissingOrFailedInCacheConstrain,
  skipIfArtifactTargetTypeNotSupportedConstrain,
} from '@tahini/artifact-step-constrains'
import { createStep, RunStrategy, toTaskEvent$ } from '@tahini/core'
import { skipIfStepIsDisabledConstrain } from '@tahini/step-constrains'
import { QuayBuildsTaskQueue } from '@tahini/task-queues'
import { buildFullDockerImageName, ExecutionStatus, Status, TargetType } from '@tahini/utils'
import { last } from 'rxjs/operators'
import { skipIfImageTagAlreadyPublishedConstrain } from './artifact-step-constrains'
import { QuayDockerPublishConfiguration } from './types'
import { calculateNextVersion, fullImageNameCacheKey, getVersionCacheKey } from './utils'

export const dockerPublish = createStep<QuayBuildsTaskQueue, QuayDockerPublishConfiguration>({
  stepName: 'docker-publish',
  taskQueueClass: QuayBuildsTaskQueue,
  constrains: {
    onArtifact: [
      skipIfArtifactTargetTypeNotSupportedConstrain({
        supportedTargetType: TargetType.docker,
      }),
      skipIfImageTagAlreadyPublishedConstrain(),
      skipIfArtifactStepResultMissingOrFailedInCacheConstrain({
        stepNameToSearchInCache: 'build',
        skipAsFailedIfStepNotFoundInCache: true,
      }),
      skipIfArtifactStepResultMissingOrFailedInCacheConstrain({
        stepNameToSearchInCache: 'test',
        skipAsFailedIfStepNotFoundInCache: true,
      }),
    ],
    onStep: [skipIfStepIsDisabledConstrain()],
  },
  run: {
    runStrategy: RunStrategy.perArtifact,
    runStepOnArtifact: async ({ currentArtifact, stepConfigurations, repoPath, log, immutableCache, taskQueue }) => {
      const newVersion = await calculateNextVersion({
        dockerRegistry: stepConfigurations.registry,
        dockerOrganizationName: stepConfigurations.dockerOrganizationName,
        packageJson: currentArtifact.data.artifact.packageJson,
        packagePath: currentArtifact.data.artifact.packagePath,
        repoPath,
        log,
      })

      const [task] = taskQueue.addTasksToQueue([
        {
          packageName: currentArtifact.data.artifact.packageJson.name,
          relativeContextPath: '/',
          relativeDockerfilePath: currentArtifact.data.artifact.packagePath,
          imageTags: [newVersion],
          taskTimeoutMs: stepConfigurations.dockerfileBuildTimeoutMs,
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
          throw new Error(`we can't be here`)
        case ExecutionStatus.aborted:
          return {
            executionStatus: ExecutionStatus.aborted,
            errors: taskResult.taskResult.errors,
            notes: taskResult.taskResult.notes,
            status: taskResult.taskResult.status,
          }
        case ExecutionStatus.done: {
          const fullImageNameNewVersion = buildFullDockerImageName({
            dockerOrganizationName: stepConfigurations.dockerOrganizationName,
            dockerRegistry: stepConfigurations.registry,
            imageName: currentArtifact.data.artifact.packageJson.name,
            imageTag: newVersion,
          })

          if (taskResult.taskResult.status === Status.passed) {
            await await immutableCache.set({
              key: getVersionCacheKey({ artifactHash: currentArtifact.data.artifact.packageHash }),
              value: newVersion,
              ttl: immutableCache.ttls.ArtifactStepResult,
            })

            const fullImageNameCacheTtl = immutableCache.ttls.ArtifactStepResult

            await immutableCache.set({
              key: fullImageNameCacheKey({ packageHash: currentArtifact.data.artifact.packageHash }),
              value: fullImageNameNewVersion,
              ttl: fullImageNameCacheTtl,
            })
          }

          return {
            executionStatus: ExecutionStatus.done,
            errors: taskResult.taskResult.errors,
            notes: [...taskResult.taskResult.notes, `published: "${fullImageNameNewVersion}"`],
            status: taskResult.taskResult.status,
          }
        }
      }
    },
  },
})
