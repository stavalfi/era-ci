import { ErrorCallback, queue } from 'async'
import chance from 'chance'
import { EventEmitter } from 'events'
import { createTaskQueue, TaskInfo, TaskQueueBase, TaskQueueEventEmitter, TaskQueueOptions } from '@era-ci/core'
import { ExecutionStatus, Status } from '@era-ci/utils'
import { serializeError } from 'serialize-error'

export type LocalSequentalTaskPayload = Record<string, never>

type ProccessedTask = { taskInfo: TaskInfo<LocalSequentalTaskPayload>; func: () => Promise<void>; startMs: number }

type Func = () => Promise<void>
export class LocalSequentalTaskQueue implements TaskQueueBase<void, LocalSequentalTaskPayload> {
  public readonly eventEmitter: TaskQueueEventEmitter<LocalSequentalTaskPayload> = new EventEmitter({
    captureRejections: true,
  })
  private readonly queueState = { isQueueKilled: false }
  private readonly taskQueue = queue(this.startTask.bind(this), 1)

  // we use this task-queue to track on non-blocking-functions (promises we don't await for) and wait for all in the cleanup.
  // why we don't await on every function (instead of using this queue): because we want to emit events after functions returns
  private readonly internalTaskQueue = queue<() => Promise<unknown>>(async task => {
    await task()
  }, 1)

  constructor(private readonly options: TaskQueueOptions<void>) {
    this.eventEmitter.setMaxListeners(Infinity)
    this.options.log.verbose(`initialized local-sequental task-queue`)
  }

  /**
   * this operation is not async to ensure that the caller can do other stuff before any of the tasks are executed
   * @param tasksOptions tasks array to preform
   */
  public addTasksToQueue = (
    tasksOptions: ({ taskName: string; func: Func } | Func)[],
  ): TaskInfo<LocalSequentalTaskPayload>[] => {
    const taskOptionsNormalized: { taskName: string; func: Func }[] = tasksOptions.map(t =>
      typeof t === 'function' ? { taskName: 'anonymous-task', func: t } : t,
    )
    if (this.queueState.isQueueKilled) {
      throw new Error(
        `task-queue was destroyed so you can not add new tasks to it. ignored tasks-names: "${taskOptionsNormalized
          .map(t => t.taskName)
          .join(', ')}"`,
      )
    }

    const tasks: TaskInfo<LocalSequentalTaskPayload>[] = taskOptionsNormalized.map(taskOptions => ({
      taskName: taskOptions.taskName,
      taskId: chance().hash().slice(0, 8),
      payload: {},
    }))

    this.internalTaskQueue.push(async () => {
      for (const [i, taskOptions] of taskOptionsNormalized.entries()) {
        this.eventEmitter.emit(ExecutionStatus.scheduled, {
          taskExecutionStatus: ExecutionStatus.scheduled,
          taskInfo: tasks[i],
          taskResult: {
            executionStatus: ExecutionStatus.scheduled,
          },
        })
        this.taskQueue.push<ProccessedTask>({
          taskInfo: tasks[i],
          func: taskOptions.func,
          startMs: Date.now(),
        })
      }
    })

    return tasks
  }

  private async startTask(task: ProccessedTask, cb: ErrorCallback) {
    const startTimeMs = Date.now()
    if (this.queueState.isQueueKilled) {
      return
    }

    this.eventEmitter.emit(ExecutionStatus.running, {
      taskExecutionStatus: ExecutionStatus.running,
      taskInfo: task.taskInfo,
      taskResult: {
        executionStatus: ExecutionStatus.running,
      },
    })
    await task.func().then(
      () =>
        !this.queueState.isQueueKilled &&
        this.eventEmitter.emit(ExecutionStatus.done, {
          taskExecutionStatus: ExecutionStatus.done,
          taskInfo: task.taskInfo,
          taskResult: {
            executionStatus: ExecutionStatus.done,
            durationMs: Date.now() - startTimeMs,
            errors: [],
            notes: [],
            status: Status.passed,
          },
        }),
      error =>
        !this.queueState.isQueueKilled &&
        this.eventEmitter.emit(ExecutionStatus.done, {
          taskExecutionStatus: ExecutionStatus.done,
          taskInfo: task.taskInfo,
          taskResult: {
            executionStatus: ExecutionStatus.done,
            durationMs: Date.now() - startTimeMs,
            errors: [serializeError(error)],
            notes: [],
            status: Status.failed,
          },
        }),
    )
    cb()
  }

  public cleanup = async (): Promise<void> => {
    if (this.queueState.isQueueKilled) {
      return
    }

    this.options.log.debug(`closing local-sequental task-queue and aborting scheduled tasks`)
    // ensure we don't send events of any processing or pending tasks
    this.queueState.isQueueKilled = true
    this.taskQueue.pause()

    if (!this.internalTaskQueue.idle()) {
      // drain will not resolve if the queue is empty so we drain if it's not empty
      await this.internalTaskQueue.drain()
    }
    this.internalTaskQueue.kill()

    // @ts-ignore - taskQueue is iterable so the types are wrong
    for (const t of [...this.taskQueue, ...this.taskQueue.workersList()]) {
      const task: ProccessedTask = t
      this.eventEmitter.emit(ExecutionStatus.aborted, {
        taskExecutionStatus: ExecutionStatus.aborted,
        taskInfo: task.taskInfo,
        taskResult: {
          executionStatus: ExecutionStatus.aborted,
          errors: [],
          notes: [],
          status: Status.skippedAsFailed,
          durationMs: Date.now() - task.startMs,
        },
      })
    }
    this.taskQueue.kill()
    this.eventEmitter.removeAllListeners()
    this.options.log.debug(`closed local-sequental task-queue and aborted scheduled tasks`)
  }
}

export const localSequentalTaskQueue = createTaskQueue<LocalSequentalTaskQueue, LocalSequentalTaskPayload>({
  taskQueueName: 'local-sequental-task-queue',
  initializeTaskQueue: async options => new LocalSequentalTaskQueue(options),
})
