import { Log, Logger } from '@era-ci/core'
import { AbortResult, DoneResult, execaCommand, ExecutionStatus, Status } from '@era-ci/utils'
import BeeQueue from 'bee-queue'
import chance from 'chance'
import Redis from 'ioredis'
import { serializeError } from 'serialize-error'
import { StartWorkerOptions, WorkerConfig, WorkerState, WorkerTask } from './types'
import prettyMs from 'pretty-ms'

export const amountOfWrokersKey = (queueName: string) => `${queueName}--amount-of-workers`
export const isFlowFinishedKey = (queueName: string) => `${queueName}--is-flow-finished`
export const generateWorkerName = (queueName: string) => `${queueName}-worker-${chance().hash().slice(0, 8)}`

export async function cleanup({
  state,
  onFinish,
  cleanups,
  connectionsCleanups,
  processEnv,
  workerLog,
}: Pick<StartWorkerOptions, 'onFinish' | 'processEnv'> & {
  state: WorkerState
  cleanups: (() => Promise<unknown>)[]
  connectionsCleanups: (() => Promise<unknown>)[]
  workerLog: Log
}): Promise<void> {
  if (!state.terminatingWorker) {
    state.terminatingWorker = true
    workerLog.debug(`closing worker`)
    await Promise.all(cleanups.map(f => f()))
    await Promise.all(connectionsCleanups.map(f => f()))
    if (onFinish) {
      await onFinish()
    }

    if (!state.allTasksSucceed) {
      // 'SKIP_EXIT_CODE_1' is for test purposes
      if (!processEnv['SKIP_EXIT_CODE_1']) {
        process.exitCode = 1
      }
    }

    workerLog.debug(`closed worker`)
  }
}

export const processTask = ({
  state,
  logger,
  workerName,
}: {
  state: WorkerState
  logger: Logger
  workerName: string
}) => {
  const tasksByGroupId = new Map<
    string,
    {
      succeedBeforeAll: boolean
      tasks: Array<WorkerTask>
    }
  >()
  return async (
    job: BeeQueue.Job<WorkerTask>,
  ): Promise<DoneResult | AbortResult<Status.failed | Status.skippedAsFailed | Status.skippedAsPassed>> => {
    const startMs = Date.now()

    if (state.terminatingWorker) {
      return {
        executionStatus: ExecutionStatus.aborted,
        status: Status.skippedAsFailed,
        durationMs: Date.now() - startMs,
        notes: [`skipping task because the worker is terminating`],
        errors: [],
      }
    }

    state.isRunningTaskNow = true
    state.receivedFirstTask = true
    state.lastTaskEndedMs = Date.now()

    const taskLog = logger.createLog(`${workerName}--task-${job.id}`)

    const { group, task } = job.data
    if (group) {
      if (!tasksByGroupId.get(group.groupId)) {
        const startBeforeAllMs = Date.now()
        taskLog.info('----------------------------------')
        taskLog.info(`executing before-all: "${group.beforeAll.shellCommand}". cwd: "${group.beforeAll.cwd}"`)
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

        const durationMs = Date.now() - startBeforeAllMs
        taskLog.info('----------------------------------')
        taskLog.info(
          `ended before-all: "${group.beforeAll.shellCommand}" - passed: ${!result.failed} (${prettyMs(
            durationMs,
          )}). cwd: "${group.beforeAll.cwd}"`,
        )
        taskLog.info('----------------------------------')

        tasksByGroupId.set(group.groupId, {
          succeedBeforeAll: !result.failed,
          tasks: [job.data],
        })

        if (result.failed) {
          state.allTasksSucceed = false
          taskLog.info('----------------------------------')
          taskLog.info(
            `skipping task: "${job.data.task.shellCommand}" because the before-all failed on this worker. cwd: "${job.data.task.cwd}"`,
          )
          taskLog.info('----------------------------------')

          return {
            executionStatus: ExecutionStatus.aborted,
            status: Status.skippedAsFailed,
            durationMs: Date.now() - startMs,
            notes: [
              `failed to run before-all-tests in worker: "${workerName}": "${group.beforeAll.shellCommand}". cwd: "${group.beforeAll.cwd}"`,
            ],
            errors: result.failed ? [serializeError('error' in result ? result.error : result)] : [],
          }
        }
      }

      if (!tasksByGroupId.get(group.groupId)?.succeedBeforeAll) {
        return {
          executionStatus: ExecutionStatus.aborted,
          status: Status.skippedAsFailed,
          durationMs: Date.now() - startMs,
          notes: [
            `failed to run before-all-tests in worker: "${workerName}": "${group.beforeAll.shellCommand}". cwd: "${group.beforeAll.cwd}"`,
          ],
          errors: [],
        }
      }

      tasksByGroupId.get(group.groupId)?.tasks.push(job.data)
    }

    if (state.terminatingWorker) {
      return {
        executionStatus: ExecutionStatus.aborted,
        status: Status.skippedAsFailed,
        durationMs: Date.now() - startMs,
        notes: [`skipping task because the worker is terminating`],
        errors: [],
      }
    }

    const startTaskMs = Date.now()
    taskLog.info('----------------------------------')
    taskLog.info(`started task: "${task.shellCommand}". cwd: "${task.cwd}"`)
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

    const durationMs = Date.now() - startTaskMs

    taskLog.info('----------------------------------')
    taskLog.info(
      `ended task: "${task.shellCommand}" - passed: ${!result.failed} (${prettyMs(durationMs)}). cwd: "${task.cwd}"`,
    )
    taskLog.info('----------------------------------')

    if (result.failed) {
      state.allTasksSucceed = false
    }

    state.lastTaskEndedMs = Date.now()
    state.isRunningTaskNow = false

    return {
      executionStatus: ExecutionStatus.done,
      status: result.failed ? Status.failed : Status.passed,
      durationMs: Date.now() - startMs,
      notes: [],
      errors: result.failed ? [serializeError('error' in result ? result.error : result)] : [],
    }
  }
}

export const isWorkerFinished = ({
  workerLog,
  state,
  config,
  workerStarteTimedMs,
  cleanup,
  redisConnection,
}: {
  workerLog: Log
  state: WorkerState
  config: WorkerConfig
  workerStarteTimedMs: number
  redisConnection: Redis.Redis
  cleanup: () => Promise<void>
}) => async () => {
  if (!state.terminatingWorker) {
    if (state.receivedFirstTask) {
      const timePassedAfterLastTaskMs = Date.now() - state.lastTaskEndedMs
      if (!state.isRunningTaskNow && timePassedAfterLastTaskMs >= config.maxWaitMsWithoutTasks) {
        workerLog.debug(`no more tasks - shutting down worker`)
        await cleanup()
        return
      }
    } else {
      const timePassedWithoutTasksMs = Date.now() - workerStarteTimedMs
      if (timePassedWithoutTasksMs >= config.maxWaitMsUntilFirstTask) {
        workerLog.debug(`no tasks at all - shutting down worker`)
        await cleanup()
        return
      }
    }

    // we do pulling because we want to avoid addtional connection just for additional subscription
    // because the free redis in redis-labs has limitation of max 20 connections at the same time.
    const isFlowFinished = await redisConnection.get(isFlowFinishedKey(config.queueName))
    if (isFlowFinished === 'true') {
      workerLog.debug(`flow finished - shutting down worker`)
      await cleanup()
      return
    }
  }
}
