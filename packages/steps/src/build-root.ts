import {
  skipIfRootPackageJsonMissingScriptConstrain,
  skipIfStepResultMissingOrFailedInCacheConstrain,
} from '@era-ci/constrains'
import { createStepExperimental, toTaskEvent$ } from '@era-ci/core'
import { TaskWorkerTaskQueue } from '@era-ci/task-queues'
import { ExecutionStatus } from '@era-ci/utils'
import { last } from 'rxjs/operators'

export const buildRoot = createStepExperimental<TaskWorkerTaskQueue, { scriptName: string }>({
  stepName: 'build-root',
  stepGroup: 'build',
  taskQueueClass: TaskWorkerTaskQueue,
  run: ({ stepConfigurations, repoPath, taskQueue }) => ({
    stepConstrains: [
      skipIfStepResultMissingOrFailedInCacheConstrain({
        stepNameToSearchInCache: 'install-root',
        skipAsPassedIfStepNotExists: true,
      }),
      skipIfRootPackageJsonMissingScriptConstrain({
        scriptName: stepConfigurations.scriptName,
      }),
    ],
    stepLogic: async () => {
      const [task] = taskQueue.addTasksToQueue([
        {
          taskName: `build`,
          shellCommand: `yarn run ${stepConfigurations.scriptName}`,
          cwd: repoPath,
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
