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

export type Worker = {
  logFilePath: string
  cleanup: () => Promise<void>
}

export async function startWorker(
  config: WorkerConfig & { repoPath: string; customLog?: (...values: unknown[]) => void },
  logger?: Logger,
): Promise<Worker> {
  const workerName = `${config.queueName}-worker-${chance().hash().slice(0, 8)}`
  const logFilePath = logger?.logFilePath ?? path.join(config.repoPath, `${workerName}.log`)

  const cleanups: (() => Promise<unknown>)[] = []

  const finalLogger =
    logger ||
    (await winstonLogger({
      customLogLevel: LogLevel.trace,
      logFilePath,
    }).callInitializeLogger({ repoPath: config.repoPath, customLog: config.customLog }))

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
        workerLog.info(`no tasks at all - shuting down worker`)
        await cleanup()
        return
      }
    }
    if (!state.isRunningTaskNow && timePassedUntilNowMs >= config.maxWaitMsWithoutTasks) {
      workerLog.info(`no more tasks - shuting down worker`)
      await cleanup()
      return
    }
  }, 500)
  cleanups.push(async () => clearInterval(intervalId))

  let closed = false
  const cleanup = async () => {
    if (!closed) {
      closed = true
      await Promise.allSettled(cleanups.map(f => f()))
      workerLog.debug(`closed worker`)
    }
  }

  const tasksByGroupId = new Map<
    string,
    {
      succeedBeforeAll: boolean
      tasks: Array<WorkerTask>
    }
  >()

  queue.process<DoneResult>(1, async job => {
    const startMs = Date.now()
    state.isRunningTaskNow = true
    if (!state.receivedFirstTask) {
      state.receivedFirstTask = true
      state.lastTaskEndedMs = Date.now()
    }

    job.reportProgress(1) // it's to nofity that we started to process this task

    const taskLog = finalLogger.createLog(`${workerName}--task-${job.id}`)

    const { group, task } = job.data
    if (group) {
      if (!tasksByGroupId.get(group.groupId)) {
        taskLog.info('----------------------------------')
        taskLog.info(`executing before-all: "${group.beforeAll.shellCommand}"`)
        taskLog.info('----------------------------------')

        const result = await execaCommand(group.beforeAll.shellCommand, {
          stdio: 'inherit',
          cwd: group.beforeAll.cwd,
          reject: false,
          log: taskLog,
          shell: true,
          env: group.beforeAll.processEnv,
        }).catch((error: unknown) => {
          // we can be here if the command is an empty string (it is covered with a test)
          return {
            failed: true,
            error,
          }
        })

        taskLog.info('----------------------------------')
        taskLog.info(`ended before-all: "${group.beforeAll.shellCommand}" - passed: ${!result.failed}.`)
        taskLog.info('----------------------------------')

        tasksByGroupId.set(group.groupId, {
          succeedBeforeAll: !result.failed,
          tasks: [job.data],
        })

        if (result.failed) {
          taskLog.info('----------------------------------')
          taskLog.info(`skipping task: "${job.data.task.shellCommand}" because the before-all failed on this worker.`)
          taskLog.info('----------------------------------')

          return {
            executionStatus: ExecutionStatus.aborted,
            status: Status.skippedAsFailed,
            durationMs: Date.now() - startMs,
            notes: [`failed to run before-all-tests in worker: "${workerName}": "${group.beforeAll.shellCommand}"`],
            errors: result.failed ? [serializeError('error' in result ? result.error : result)] : [],
          }
        }
      }

      if (!tasksByGroupId.get(group.groupId)?.succeedBeforeAll) {
        return {
          executionStatus: ExecutionStatus.aborted,
          status: Status.skippedAsFailed,
          durationMs: Date.now() - startMs,
          notes: [`failed to run before-all-tests in worker: "${workerName}": "${group.beforeAll.shellCommand}"`],
          errors: [],
        }
      }

      tasksByGroupId.get(group.groupId)?.tasks.push(job.data)
    }

    taskLog.info('----------------------------------')
    taskLog.info(`started task: "${task.shellCommand}"`)
    taskLog.info('----------------------------------')

    const result = await execaCommand(task.shellCommand, {
      stdio: 'inherit',
      cwd: task.cwd,
      reject: false,
      log: taskLog,
      shell: true,
      env: task.processEnv,
    }).catch((error: unknown) => {
      // we can be here if the command is an empty string (it is covered with a test)
      return {
        failed: true,
        error,
      }
    })

    taskLog.info('----------------------------------')
    taskLog.info(`ended task: "${task.shellCommand}" - passed: ${!result.failed}`)
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

  workerLog.info('----------------------------------')
  workerLog.info(`starting listen for tasks`)
  workerLog.info('----------------------------------')

  return {
    logFilePath,
    cleanup,
  }
}

if (require.main === module) {
  main()
}
