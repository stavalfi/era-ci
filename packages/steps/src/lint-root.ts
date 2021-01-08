import {
  skipIfRootPackageJsonMissingScriptConstrain,
  skipIfStepResultMissingOrFailedInCacheConstrain,
  skipIfStepResultMissingOrPassedInCacheConstrain,
} from '@era-ci/constrains'
import { createStepExperimental, toTaskEvent$ } from '@era-ci/core'
import { TaskWorkerTaskQueue } from '@era-ci/task-queues'
import { ExecutionStatus } from '@era-ci/utils'
import { last } from 'rxjs/operators'

export const lintRoot = createStepExperimental<TaskWorkerTaskQueue, { scriptName: string }>({
  stepName: 'lint-root',
  stepGroup: 'lint',
  taskQueueClass: TaskWorkerTaskQueue,
  run: ({ repoPath, taskQueue, stepConfigurations }) => ({
    stepConstrains: [
      skipIfRootPackageJsonMissingScriptConstrain({
        scriptName: stepConfigurations.scriptName,
      }),
      skipIfStepResultMissingOrPassedInCacheConstrain({
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
          return taskResult.taskResult
        case ExecutionStatus.done: {
          return taskResult.taskResult
        }
      }
    },
  }),
})
