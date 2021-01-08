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

export type TestUsingTaskWorkerConfigurations = {
  scriptName: string
  queueName: string
  redis: {
    url: string
    auth?: {
      // username is not supported in bee-queue because bee-queue uses redis and it doesn't support redis-acl:
      // https://github.com/NodeRedis/node-redis/issues/1451
      // in next-major version of bee-queue, they will move to ioredis so then we can use "username".
      password?: string
    }
  }
  beforeAll?: (
    options: Omit<UserRunStepOptions<TaskWorkerTaskQueue, TestUsingTaskWorkerConfigurations>, 'stepConfigurations'>,
  ) => Promise<unknown>
  afterAll?: (
    options: Omit<UserRunStepOptions<TaskWorkerTaskQueue, TestUsingTaskWorkerConfigurations>, 'stepConfigurations'>,
  ) => Promise<unknown>
}

export const testUsingTaskWorker = createStepExperimental<TaskWorkerTaskQueue, TestUsingTaskWorkerConfigurations>({
  stepName: 'test-using-task-worker',
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
          stepNameToSearchInCache: 'test-using-task-worker',
        }),
      artifact =>
        skipIfArtifactStepResultMissingOrPassedInCacheConstrain({
          currentArtifact: artifact,
          stepNameToSearchInCache: 'test-using-task-worker',
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
