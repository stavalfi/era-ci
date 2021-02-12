import {
  skipIfRootPackageJsonMissingScriptConstrain,
  skipIfStepIsDisabledConstrain,
  skipIfStepResultMissingOrFailedInCacheConstrain,
  skipIfStepResultPassedInCacheConstrain,
} from '@era-ci/constrains'
import { createStep, toTaskEvent$ } from '@era-ci/core'
import { TaskWorkerTaskQueue } from '@era-ci/task-queues'
import { ExecutionStatus, lastValueFrom } from '@era-ci/utils'

export const lintRoot = createStep<TaskWorkerTaskQueue, { isStepEnabled: boolean; scriptName: string }>({
  stepName: 'lint-root',
  stepGroup: 'lint',
  taskQueueClass: TaskWorkerTaskQueue,
  run: async ({ repoPath, taskQueue, stepConfigurations, log }) => ({
    globalConstrains: [skipIfStepIsDisabledConstrain()],
    stepConstrains: [
      skipIfRootPackageJsonMissingScriptConstrain({
        scriptName: stepConfigurations.scriptName,
      }),
      skipIfStepResultPassedInCacheConstrain({
        stepNameToSearchInCache: 'lint-root',
        skipAsPassedIfStepNotExists: true,
      }),
      skipIfStepResultMissingOrFailedInCacheConstrain({
        stepNameToSearchInCache: 'lint-root',
        skipAsPassedIfStepNotExists: true,
      }),
    ],
    stepLogic: async () => {
      const [task] = taskQueue.addTasksToQueue([
        {
          taskName: `lint`,
          task: {
            shellCommand: `yarn run ${stepConfigurations.scriptName}`,
            cwd: repoPath,
          },
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
          log.info(`lint passed`)
          return taskResult.taskResult
        case ExecutionStatus.done: {
          log.error(`failed to run lint`)
          return taskResult.taskResult
        }
      }
    },
  }),
})
