import { skipIfStepIsDisabledConstrain } from '@tahini/constrains'
import {
  ConstrainResultType,
  createStepExperimental,
  runConstrains,
  StepEventType,
  StepInputEvents,
  StepOutputEvents,
  toTaskEvent$,
  UserRunStepOptions,
} from '@tahini/core'
import { QuayBuildsTaskQueue } from '@tahini/task-queues'
import { Artifact, buildFullDockerImageName, ExecutionStatus, Node, Status, TargetType } from '@tahini/utils'
import {
  skipIfArtifactStepResultMissingOrFailedInCacheConstrain,
  skipIfArtifactTargetTypeNotSupportedConstrain,
} from 'constrains/src'
import path from 'path'
import { of } from 'rxjs'
import { last, mergeMap } from 'rxjs/operators'
import { skipIfImageTagAlreadyPublishedConstrain } from './constrains'
import { QuayDockerPublishConfiguration } from './types'
import { calculateNextVersion, fullImageNameCacheKey, getVersionCacheKey } from './utils'

async function publishPackage({
  stepConfigurations,
  repoPath,
  log,
  immutableCache,
  currentArtifact,
  taskQueue,
}: UserRunStepOptions<QuayBuildsTaskQueue, QuayDockerPublishConfiguration> & {
  currentArtifact: Node<{ artifact: Artifact }>
}): Promise<StepOutputEvents[StepEventType.artifactStep]> {
  const newVersion = await calculateNextVersion({
    dockerRegistry: stepConfigurations.registry,
    dockerOrganizationName: stepConfigurations.dockerOrganizationName,
    packageJson: currentArtifact.data.artifact.packageJson,
    packagePath: currentArtifact.data.artifact.packagePath,
    repoPath,
    log,
    imageName: currentArtifact.data.artifact.packageJson.name,
  })

  const [task] = taskQueue.addTasksToQueue([
    {
      packageName: currentArtifact.data.artifact.packageJson.name,
      relativeContextPath: '/',
      relativeDockerfilePath: path.relative(
        repoPath,
        path.join(currentArtifact.data.artifact.packagePath, 'Dockerfile'),
      ),
      imageTags: [newVersion],
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
      throw new Error(`we can't be here`)
    case ExecutionStatus.aborted:
      return {
        type: StepEventType.artifactStep,
        artifactName: currentArtifact.data.artifact.packageJson.name,
        artifactStepResult: {
          executionStatus: ExecutionStatus.aborted,
          errors: taskResult.taskResult.errors,
          notes: taskResult.taskResult.notes,
          status: taskResult.taskResult.status,
        },
      }
    case ExecutionStatus.done: {
      const fullImageNameNewVersion = buildFullDockerImageName({
        dockerOrganizationName: stepConfigurations.dockerOrganizationName,
        dockerRegistry: stepConfigurations.registry,
        imageName: currentArtifact.data.artifact.packageJson.name,
        imageTag: newVersion,
      })

      const notes = [...taskResult.taskResult.notes]

      if (taskResult.taskResult.status === Status.passed) {
        await immutableCache.set({
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
        notes.push(`published: "${fullImageNameNewVersion}"`)
      }

      return {
        type: StepEventType.artifactStep,
        artifactName: currentArtifact.data.artifact.packageJson.name,
        artifactStepResult: {
          executionStatus: ExecutionStatus.done,
          errors: taskResult.taskResult.errors,
          notes,
          status: taskResult.taskResult.status,
        },
      }
    }
  }
}

export const quayDockerPublish = createStepExperimental<QuayBuildsTaskQueue, QuayDockerPublishConfiguration>({
  stepName: 'quay-docker-publish',
  taskQueueClass: QuayBuildsTaskQueue,
  run: async options => {
    const constrainsResult = await runConstrains([skipIfStepIsDisabledConstrain()])

    if (constrainsResult.combinedResultType === ConstrainResultType.shouldSkip) {
      return of({
        type: StepEventType.step,
        stepResult: constrainsResult.combinedResult,
      })
    }

    return options.stepInputEvents$.pipe(
      mergeMap<StepInputEvents[StepEventType], Promise<StepOutputEvents[StepEventType]>>(async e => {
        if (e.type === StepEventType.artifactStep && e.artifactStepResult.executionStatus === ExecutionStatus.done) {
          const constrainsResult = await runConstrains([
            skipIfArtifactTargetTypeNotSupportedConstrain({
              currentArtifact: e.artifact,
              supportedTargetType: TargetType.docker,
            }),
            skipIfArtifactStepResultMissingOrFailedInCacheConstrain({
              currentArtifact: e.artifact,
              stepNameToSearchInCache: 'build',
              skipAsFailedIfStepNotFoundInCache: true,
              skipAsPassedIfStepNotExists: true,
            }),
            skipIfArtifactStepResultMissingOrFailedInCacheConstrain({
              currentArtifact: e.artifact,
              stepNameToSearchInCache: 'test',
              skipAsFailedIfStepNotFoundInCache: true,
              skipAsPassedIfStepNotExists: true,
            }),
            skipIfImageTagAlreadyPublishedConstrain({ currentArtifact: e.artifact }),
          ])

          if (constrainsResult.combinedResultType === ConstrainResultType.shouldSkip) {
            return {
              type: StepEventType.artifactStep,
              artifactName: e.artifact.data.artifact.packageJson.name,
              artifactStepResult: constrainsResult.combinedResult,
            }
          }

          return publishPackage({
            ...options,
            currentArtifact: e.artifact,
          })
        } else {
          return e
        }
      }),
    )
  },
})
