import {
  skipIfArtifactPackageJsonMissingScriptConstrain,
  skipIfArtifactStepResultMissingOrFailedInCacheConstrain,
  skipIfArtifactStepResultMissingOrPassedInCacheConstrain,
  skipIfStepResultNotPassedConstrain,
} from '@tahini/constrains'
import { createStepExperimental, UserRunStepOptions } from '@tahini/core'
import { LocalSequentalTaskQueue } from '@tahini/task-queues'
import { startWorker, WorkerTask } from '@tahini/task-worker'
import { DoneResult } from '@tahini/utils'
import Queue from 'bee-queue'
import Redis from 'ioredis'
import _ from 'lodash'

export type TestConfigurations = {
  scriptName: string
  queueName: string
  redisServerUri: string
  beforeAll?: (
    options: Omit<UserRunStepOptions<LocalSequentalTaskQueue, TestConfigurations>, 'stepConfigurations'>,
  ) => Promise<unknown>
  afterAll?: (
    options: Omit<UserRunStepOptions<LocalSequentalTaskQueue, TestConfigurations>, 'stepConfigurations'>,
  ) => Promise<unknown>
}

export const test = createStepExperimental<LocalSequentalTaskQueue, TestConfigurations>({
  stepName: 'test-by-task-worker',
  stepGroup: 'test',
  taskQueueClass: LocalSequentalTaskQueue,
  run: options => {
    let taskWorkerCleanup: () => Promise<unknown>
    const redisConnection = new Redis(options.stepConfigurations.redisServerUri)
    const queue = new Queue<WorkerTask>(options.stepConfigurations.queueName, {
      redis: options.stepConfigurations.redisServerUri,
      removeOnSuccess: true,
      removeOnFailure: true,
    })
    return {
      stepConstrains: [
        skipIfStepResultNotPassedConstrain({
          stepName: 'install-root',
        }),
      ],
      artifactConstrains: [
        artifact =>
          skipIfArtifactPackageJsonMissingScriptConstrain({
            currentArtifact: artifact,
            scriptName: 'test-by-task-worker',
          }),
        artifact =>
          skipIfArtifactStepResultMissingOrFailedInCacheConstrain({
            currentArtifact: artifact,
            stepNameToSearchInCache: 'test-by-task-worker',
            skipAsFailedIfStepResultNotFoundInCache: false,
          }),
        artifact =>
          skipIfArtifactStepResultMissingOrPassedInCacheConstrain({
            currentArtifact: artifact,
            stepNameToSearchInCache: 'test-by-task-worker',
            skipAsFailedIfStepResultNotFoundInCache: false,
          }),
      ],
      onBeforeArtifacts: async () => {
        const result = await startWorker({
          queueName: options.stepConfigurations.queueName,
          redisServerUri: options.stepConfigurations.redisServerUri,
          repoPath: options.repoPath,
          waitBeforeExitMs: 100_000_000,
        })
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
        redisConnection.disconnect()
        await taskWorkerCleanup()
      },
    }
  },
})
