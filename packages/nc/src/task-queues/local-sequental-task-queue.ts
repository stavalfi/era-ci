import { ErrorCallback, queue } from 'async'
import chance from 'chance'
import { EventEmitter } from 'events'
import {
  createTaskQueue,
  ScheduledTask,
  TaskInfo,
  TaskQueueBase,
  TaskQueueEventEmitter,
  TaskQueueOptions,
} from '../create-task-queue'
import { ExecutionStatus, Status } from '../types'

type ProccessedTask = { taskInfo: TaskInfo; func: () => Promise<void> }

export class LocalSequentalTaskQueue implements TaskQueueBase<void> {
  public readonly eventEmitter: TaskQueueEventEmitter = new EventEmitter({
    captureRejections: true,
  })
  private readonly queueState = { isQueueKilled: false }
  private readonly taskQueue = queue(this.startTask.bind(this), 1)

  constructor(private readonly options: TaskQueueOptions<void>) {
    this.options.log.verbose(`initialized local-sequental task-queue`)
  }

  /**
   * this operation is not async to ensure that the caller can do other stuff before any of the tasks are executed
   * @param tasksOptions tasks array to preform
   */
  public addTasksToQueue(tasksOptions: { taskName: string; func: () => Promise<void> }[]): ScheduledTask[] {
    if (this.queueState.isQueueKilled) {
      throw new Error(
        `task-queue was destroyed so you can not add new tasks to it. ignored tasks-names: "${tasksOptions
          .map(t => t.taskName)
          .join(', ')}"`,
      )
    }
    const result: ScheduledTask[] = []

    for (const taskOptions of tasksOptions) {
      const taskInfo: TaskInfo = {
        taskName: taskOptions.taskName,
        taskId: chance().hash(),
      }

      this.taskQueue.push<ProccessedTask, unknown>({ taskInfo, func: taskOptions.func })
      result.push({
        taskExecutionStatus: ExecutionStatus.scheduled,
        taskInfo,
        taskResult: {
          executionStatus: ExecutionStatus.scheduled,
        },
      })
      // this line will be executed before async.queue will
      // process the task so we can be sure that `scheduled` is the first event.
      this.eventEmitter.emit(ExecutionStatus.scheduled, result[result.length - 1])
    }

    return result
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
            errors: [error],
            notes: [],
            status: Status.failed,
          },
        }),
    )
    cb()
  }

  public async cleanup(): Promise<void> {
    if (this.queueState.isQueueKilled) {
      return
    }

    this.options.log.verbose(`closing local-sequental task-queue and aborting scheduled tasks`)
    // ensure we don't send events of any processing or pending tasks
    this.queueState.isQueueKilled = true
    this.taskQueue.pause()
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
        },
      })
    }
    this.taskQueue.kill()
    this.options.log.verbose(`closed local-sequental task-queue and aborted scheduled tasks`)
  }
}

export const localSequentalTaskQueue = createTaskQueue<LocalSequentalTaskQueue>({
  taskQueueName: 'local-sequental-task-queue',
  initializeTaskQueue: async options => new LocalSequentalTaskQueue(options),
})
