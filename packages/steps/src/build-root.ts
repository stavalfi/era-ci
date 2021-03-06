import {
  skipAsFailedIfStepResultFailedInCacheConstrain,
  skipAsPassedIfRootPackageJsonMissingScriptConstrain,
  skipAsPassedIfStepIsDisabledConstrain,
} from '@era-ci/constrains'
import { createStep, toTaskEvent$ } from '@era-ci/core'
import { TaskWorkerTaskQueue } from '@era-ci/task-queues'
import { ExecutionStatus } from '@era-ci/utils'
import { lastValueFrom } from 'rxjs'

export const buildRoot = createStep<TaskWorkerTaskQueue, { isStepEnabled: boolean; scriptName: string }>({
  stepName: 'build-root',
  stepGroup: 'build',
  taskQueueClass: TaskWorkerTaskQueue,
  run: async ({ stepConfigurations, repoPath, taskQueue }) => ({
    globalConstrains: [skipAsPassedIfStepIsDisabledConstrain()],
    stepConstrains: [
      skipAsFailedIfStepResultFailedInCacheConstrain({
        stepNameToSearchInCache: 'install-root',
        skipAsPassedIfStepNotExists: true,
      }),
      skipAsPassedIfRootPackageJsonMissingScriptConstrain({
        scriptName: stepConfigurations.scriptName,
      }),
    ],
    stepLogic: async () => {
      const [task] = taskQueue.addTasksToQueue([
        {
          taskName: `build`,
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
          return taskResult.taskResult
        case ExecutionStatus.done: {
          return taskResult.taskResult
        }
      }
    },
  }),
})
