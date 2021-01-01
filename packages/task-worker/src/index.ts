import { LogLevel } from '@tahini/core'
import { winstonLogger } from '@tahini/loggers'
import { DoneResult, execaCommand, ExecutionStatus, Status } from '@tahini/utils'
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
): Promise<{ cleanup: () => Promise<void> }> {
  const workerName = `${config.queueName}-worker-${chance().hash().slice(0, 8)}`

  const logger = await winstonLogger({
    customLogLevel: LogLevel.trace,
    logFilePath: path.join(config.repoPath, `${workerName}.log`),
    disableFileOutput: true,
  }).callInitializeLogger({ repoPath: config.repoPath })

  const queue = new Queue<WorkerTask>(config.queueName, {
    redis: { host: config.redis.host, port: config.redis.port },
    removeOnSuccess: true,
    removeOnFailure: true,
  })

  const redisConnection = new Redis({ host: config.redis.host, port: config.redis.port, lazyConnect: true })

  await Promise.all([queue.ready(), redisConnection.connect()])

  await redisConnection.incr(amountOfWrokersKey(config.queueName))

  const state = {
    isRunningTaskNow: false,
    lastTaskEndedMs: Date.now(),
  }

  const workerLog = logger.createLog(workerName)

  const intervalId = setInterval(async () => {
    const timePassedUntilNowMs = Date.now() - state.lastTaskEndedMs
    if (!state.isRunningTaskNow && timePassedUntilNowMs >= config.waitBeforeExitMs) {
      await cleanup()
      workerLog.info(`no more tasks - shuting down worker`)
    }
  }, 500)

  let closed = false
  const cleanup = async () => {
    if (!closed) {
      closed = true
      clearInterval(intervalId)
      await redisConnection.decr(amountOfWrokersKey(config.queueName))
      await Promise.all([queue.close(), redisConnection.disconnect()])
    }
  }

  queue.process<DoneResult>(1, async job => {
    const startMs = Date.now()
    state.isRunningTaskNow = true

    const taskLog = logger.createLog(`${workerName}--task-${job.id}`)

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
    cleanup,
  }
}

if (require.main === module) {
  main()
}
