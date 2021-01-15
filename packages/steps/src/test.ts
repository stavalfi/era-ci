import {
  skipIfArtifactPackageJsonMissingScriptConstrain,
  skipIfArtifactStepResultMissingOrFailedInCacheConstrain,
  skipIfArtifactStepResultMissingOrPassedInCacheConstrain,
  skipIfStepResultMissingOrFailedInCacheConstrain,
} from '@era-ci/constrains'
import { createStepExperimental, toTaskEvent$ } from '@era-ci/core'
import { TaskWorkerTaskQueue } from '@era-ci/task-queues'
import { ExecutionStatus } from '@era-ci/utils'
import { lastValueFrom } from 'rxjs'

export type TestConfigurations = {
  scriptName: string
  workerBeforeAll?: {
    shellCommand: string
    cwd: string
    processEnv?: NodeJS.ProcessEnv
  }
}

export const test = createStepExperimental<TaskWorkerTaskQueue, TestConfigurations>({
  stepName: 'test',
  stepGroup: 'test',
  taskQueueClass: TaskWorkerTaskQueue,
  run: options => ({
    stepConstrains: [
      skipIfStepResultMissingOrFailedInCacheConstrain({
        stepNameToSearchInCache: 'install-root',
        skipAsPassedIfStepNotExists: true,
      }),
    ],
    artifactConstrains: [
      artifact =>
        skipIfArtifactPackageJsonMissingScriptConstrain({
          currentArtifact: artifact,
          scriptName: 'test',
        }),
      artifact =>
        skipIfArtifactStepResultMissingOrFailedInCacheConstrain({
          currentArtifact: artifact,
          stepNameToSearchInCache: 'test',
        }),
      artifact =>
        skipIfArtifactStepResultMissingOrPassedInCacheConstrain({
          currentArtifact: artifact,
          stepNameToSearchInCache: 'test',
        }),
    ],
    onArtifact: async ({ artifact }) => {
      const { workerBeforeAll } = options.stepConfigurations
      const [task] = options.taskQueue.addTasksToQueue([
        {
          group: workerBeforeAll && {
            groupId: `${options.flowId}-${options.currentStepInfo.data.stepInfo.stepId}`,
            beforeAll: workerBeforeAll,
          },
          taskName: `${artifact.data.artifact.packageJson.name}---tests`,
          task: {
            shellCommand: `yarn run ${options.stepConfigurations.scriptName}`,
            cwd: artifact.data.artifact.packagePath,
          },
        },
      ])
      const taskResult = await lastValueFrom(
        toTaskEvent$(task.taskId, {
          eventEmitter: options.taskQueue.eventEmitter,
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
          return taskResult.taskResult
        }
      }
    },
  }),
})
