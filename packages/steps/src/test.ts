import {
  skipIfArtifactPackageJsonMissingScriptConstrain,
  skipIfArtifactStepResultMissingOrFailedInCacheConstrain,
  skipIfArtifactStepResultMissingOrPassedInCacheConstrain,
  skipIfStepResultMissingOrFailedInCacheConstrain,
} from '@era-ci/constrains'
import { createStepExperimental, toTaskEvent$, UserRunStepOptions } from '@era-ci/core'
import { TaskWorkerTaskQueue } from '@era-ci/task-queues'
import { ExecutionStatus } from '@era-ci/utils'
import _ from 'lodash'
import { last } from 'rxjs/operators'

export type TestConfigurations = {
  scriptName: string
  beforeAll?: (
    options: Omit<UserRunStepOptions<TaskWorkerTaskQueue, TestConfigurations>, 'stepConfigurations'>,
  ) => Promise<unknown>
  afterAll?: (
    options: Omit<UserRunStepOptions<TaskWorkerTaskQueue, TestConfigurations>, 'stepConfigurations'>,
  ) => Promise<unknown>
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
    onBeforeArtifacts: async () => {
      if (options.stepConfigurations.beforeAll) {
        await options.stepConfigurations.beforeAll(_.omit(options, 'stepConfigurations'))
      }
    },
    onArtifact: async ({ artifact }) => {
      const [task] = options.taskQueue.addTasksToQueue([
        {
          taskName: `${artifact.data.artifact.packageJson.name}---tests`,
          shellCommand: `yarn run ${options.stepConfigurations.scriptName}`,
          cwd: artifact.data.artifact.packagePath,
        },
      ])
      const taskResult = await toTaskEvent$(task.taskId, {
        eventEmitter: options.taskQueue.eventEmitter,
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
    onAfterArtifacts: async () => {
      if (options.stepConfigurations.afterAll) {
        await options.stepConfigurations.afterAll(_.omit(options, 'stepConfigurations'))
      }
    },
  }),
})
