import { Logger, LogLevel } from '@era-ci/core'
import { winstonLogger } from '@era-ci/loggers'
import { DoneResult, execaCommand, ExecutionStatus, Status } from '@era-ci/utils'
import Queue from 'bee-queue'
import path from 'path'
import { serializeError } from 'serialize-error'
import yargsParser from 'yargs-parser'
import { parseConfig } from './parse-config-file'
import { WorkerTask, WorkerConfig } from './types'
import Redis from 'ioredis'
import chance from 'chance'

export { WorkerTask, WorkerConfig }

export function config(config: WorkerConfig): WorkerConfig {
  return config
}

export const amountOfWrokersKey = (queueName: string) => `${queueName}--amount-of-workers`

export async function main(): Promise<void> {
  const argv = yargsParser(process.argv.slice(2), {
    string: ['repo-path'],
    default: {
      'repo-path': process.cwd(),
    },
  })

  const repoPath = argv['repo-path']
  const configFilePath = path.join(repoPath, 'task-worker.config.ts')
  const config = await parseConfig(configFilePath)

  await startWorker({ ...config, repoPath })
}

export async function startWorker(
  config: WorkerConfig & { repoPath: string },
  logger?: Logger,
): Promise<{ logFilePath: string; cleanup: () => Promise<void> }> {
  const workerName = `${config.queueName}-worker-${chance().hash().slice(0, 8)}`
  const logFilePath = path.join(config.repoPath, `${workerName}.log`)

  const cleanups: (() => Promise<unknown>)[] = []

  const finalLogger =
    logger ||
    (await winstonLogger({
      customLogLevel: LogLevel.trace,
      logFilePath,
    }).callInitializeLogger({ repoPath: config.repoPath }))

  const queue = new Queue<WorkerTask>(config.queueName, {
    redis: {
      url: config.redis.url,
      password: config.redis.auth?.password,
    },
    removeOnSuccess: true,
    removeOnFailure: true,
  })
  cleanups.push(() => queue.close())

  const redisConnection = new Redis(config.redis.url, { password: config.redis.auth?.password })

  await queue.ready()

  await redisConnection.incr(amountOfWrokersKey(config.queueName))
  cleanups.push(async () => {
    await redisConnection.decr(amountOfWrokersKey(config.queueName))
    redisConnection.disconnect()
  })

  const state = {
    receivedFirstTask: false,
    isRunningTaskNow: false,
    lastTaskEndedMs: Date.now(),
  }

  const workerLog = finalLogger.createLog(workerName)

  const intervalId = setInterval(async () => {
    const timePassedUntilNowMs = Date.now() - state.lastTaskEndedMs
    if (!state.receivedFirstTask) {
      if (timePassedUntilNowMs < config.maxWaitMsUntilFirstTask) {
        return
      } else {
        await cleanup()
        workerLog.info(`no tasks at all - shuting down worker`)
        return
      }
    }
    if (!state.isRunningTaskNow && timePassedUntilNowMs >= config.maxWaitMsWithoutTasks) {
      await cleanup()
      workerLog.info(`no more tasks - shuting down worker`)
      return
    }
  }, 500)
  cleanups.push(async () => clearInterval(intervalId))

  let closed = false
  const cleanup = async () => {
    if (!closed) {
      closed = true
      await Promise.allSettled(cleanups.map(f => f()))
    }
  }

  queue.process<DoneResult>(1, async job => {
    const startMs = Date.now()
    state.isRunningTaskNow = true
    if (!state.receivedFirstTask) {
      state.receivedFirstTask = true
      state.lastTaskEndedMs = Date.now()
    }

    const taskLog = finalLogger.createLog(`${workerName}--task-${job.id}`)

    taskLog.info('----------------------------------')
    taskLog.info(`started task`)
    taskLog.info('----------------------------------')

    const result = await execaCommand(job.data.shellCommand, {
      stdio: 'inherit',
      cwd: job.data.cwd,
      reject: false,
      log: taskLog,
      shell: true,
    }).catch((error: unknown) => {
      // we can be here if the command is an empty string (it is covered with a test)
      return {
        failed: true,
        error,
      }
    })

    taskLog.info('----------------------------------')
    taskLog.info(`ended task - passed: ${!result.failed}`)
    taskLog.info('----------------------------------')

    state.lastTaskEndedMs = Date.now()
    state.isRunningTaskNow = false

    return {
      executionStatus: ExecutionStatus.done,
      status: result.failed ? Status.failed : Status.passed,
      durationMs: Date.now() - startMs,
      notes: [],
      errors: result.failed ? [serializeError('error' in result ? result.error : result)] : [],
    }
  })

  return {
    logFilePath,
    cleanup,
  }
}

if (require.main === module) {
  main()
}
