// if we load this module with jest, the source map are corrupted
// eslint-disable-next-line no-process-env
if (!process.env.ERA_TEST_MODE) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('source-map-support').install()
}

import { LogLevel } from '@era-ci/core'
import { winstonLogger } from '@era-ci/loggers'
import BeeQueue from 'bee-queue'
import Redis from 'ioredis'
import path from 'path'
import yargsParser from 'yargs-parser'
import { parseConfig } from './parse-config-file'
import { StartWorkerOptions, TaskWorker, WorkerConfig, WorkerState, WorkerTask } from './types'
import {
  amountOfWrokersKey,
  cleanup,
  generateWorkerName,
  isFlowFinishedKey,
  isWorkerFinished,
  processTask,
} from './utils'

export { WorkerTask, WorkerConfig, isWorkerFinished, amountOfWrokersKey, TaskWorker, isFlowFinishedKey }

export function config(config: WorkerConfig): WorkerConfig {
  return config
}

export async function main(processEnv: NodeJS.ProcessEnv, processArgv: string[]): Promise<void> {
  const argv = yargsParser(processArgv, {
    string: ['repo-path'],
    default: {
      'repo-path': process.cwd(),
    },
  })

  const repoPath = argv['repo-path']
  const configFilePath = path.join(repoPath, 'task-worker.config.ts')
  const config = await parseConfig(configFilePath)

  const connectionsCleanups: (() => Promise<unknown>)[] = []

  const redisConnection = new Redis(config.redis.url, {
    showFriendlyErrorStack: true,
    password: config.redis.auth?.password,
  })

  connectionsCleanups.push(async () => redisConnection.disconnect())

  const workerName = generateWorkerName(config.queueName)

  const logger = await winstonLogger({
    customLogLevel: LogLevel.trace,
    logFilePath: path.join(repoPath, `${workerName}.log`),
  }).callInitializeLogger({
    repoPath,
  })

  await startWorker({
    config,
    logger,
    processEnv,
    redisConnection,
    connectionsCleanups,
    workerName,
  })
}

export async function startWorker({
  connectionsCleanups = [],
  processEnv,
  onFinish,
  config,
  workerName = generateWorkerName(config.queueName),
  redisConnection,
  logger,
}: StartWorkerOptions): Promise<TaskWorker> {
  const cleanups: (() => Promise<unknown>)[] = []

  await redisConnection.incr(amountOfWrokersKey(config.queueName))
  cleanups.push(() => {
    return redisConnection.decr(amountOfWrokersKey(config.queueName))
  })

  const workerStarteTimedMs = Date.now()

  const state: WorkerState = {
    receivedFirstTask: false,
    isRunningTaskNow: false,
    allTasksSucceed: true,
    lastTaskEndedMs: Date.now(),
    terminatingWorker: false,
  }

  const workerLog = logger.createLog(workerName)

  const queue = new BeeQueue<WorkerTask>(config.queueName, {
    redis: { url: config.redis.url, password: config.redis.auth?.password },
    removeOnSuccess: true,
    removeOnFailure: true,
  })
  cleanups.push(() => queue.close())

  queue.process(processTask({ workerName, logger, state }))

  await queue.ready()

  workerLog.verbose('----------------------------------')
  workerLog.verbose(`starting listen for tasks`)
  workerLog.verbose('----------------------------------')

  const cleanupFunc = () =>
    cleanup({
      state,
      onFinish,
      cleanups,
      connectionsCleanups,
      processEnv,
      workerLog,
    })

  const intervalId = setInterval(
    isWorkerFinished({
      workerLog,
      state,
      config,
      workerStarteTimedMs,
      cleanup: cleanupFunc,
      redisConnection,
    }),
    1_000,
  )

  cleanups.push(async () => clearInterval(intervalId))

  return {
    logFilePath: logger.logFilePath,
    cleanup: cleanupFunc,
  }
}

if (require.main === module) {
  // eslint-disable-next-line no-process-env
  main(process.env, process.argv.slice(2))
}
