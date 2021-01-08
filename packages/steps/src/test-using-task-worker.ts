import {
  skipIfArtifactPackageJsonMissingScriptConstrain,
  skipIfArtifactStepResultMissingOrFailedInCacheConstrain,
  skipIfArtifactStepResultMissingOrPassedInCacheConstrain,
  skipIfStepResultMissingOrFailedInCacheConstrain,
} from '@era-ci/constrains'
import { createStepExperimental, UserRunStepOptions } from '@era-ci/core'
import { LocalSequentalTaskQueue } from '@era-ci/task-queues'
import { startWorker, WorkerTask } from '@era-ci/task-worker'
import { DoneResult } from '@era-ci/utils'
import Queue from 'bee-queue'
import _ from 'lodash'

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
    options: Omit<UserRunStepOptions<LocalSequentalTaskQueue, TestUsingTaskWorkerConfigurations>, 'stepConfigurations'>,
  ) => Promise<unknown>
  afterAll?: (
    options: Omit<UserRunStepOptions<LocalSequentalTaskQueue, TestUsingTaskWorkerConfigurations>, 'stepConfigurations'>,
  ) => Promise<unknown>
}

export const testUsingTaskWorker = createStepExperimental<LocalSequentalTaskQueue, TestUsingTaskWorkerConfigurations>({
  stepName: 'test-using-task-worker',
  stepGroup: 'test',
  taskQueueClass: LocalSequentalTaskQueue,
  run: options => {
    let taskWorkerCleanup: () => Promise<unknown>
    let queue: Queue<WorkerTask>
    return {
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
        queue = new Queue<WorkerTask>(options.stepConfigurations.queueName, {
          redis: {
            url: options.stepConfigurations.redis.url,
            password: options.stepConfigurations.redis.auth?.password,
          },
          removeOnSuccess: true,
          removeOnFailure: true,
        })
        const result = await startWorker(
          {
            queueName: options.stepConfigurations.queueName,
            repoPath: options.repoPath,
            maxWaitMsWithoutTasks: 300_000,
            maxWaitMsUntilFirstTask: 300_000,
            redis: options.stepConfigurations.redis,
          },
          options.logger,
        )
        taskWorkerCleanup = result.cleanup
        if (options.stepConfigurations.beforeAll) {
          await options.stepConfigurations.beforeAll(_.omit(options, 'stepConfigurations'))
        }
      },
      onArtifact: async ({ artifact }) => {
        const task = queue.createJob({
          shellCommand: `yarn run ${options.stepConfigurations.scriptName}`,
          cwd: artifact.data.artifact.packagePath,
        })
        return new Promise<DoneResult>(res => {
          task.once('succeeded', res)
          task.save()
        })
      },
      onAfterArtifacts: async () => {
        if (options.stepConfigurations.afterAll) {
          await options.stepConfigurations.afterAll(_.omit(options, 'stepConfigurations'))
        }
        await taskWorkerCleanup()
        await queue.close()
      },
    }
  },
})
