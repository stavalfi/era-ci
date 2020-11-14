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

  public async addTasksToQueue(
    tasksOptions: { taskName: string; func: () => Promise<void> }[],
  ): Promise<ScheduledTask[]> {
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
    this.options.log.verbose(`closing local-sequental task-queue and aborting scheduled tasks`)
    // ensure we don't send events of any processing or pending tasks
    this.queueState.isQueueKilled = true
    this.taskQueue.pause()
    // @ts-ignore - taskQueue is iterable so the types are wrong
    for (const t of [...taskQueue, ...taskQueue.workersList()]) {
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
  initializeTaskQueue: async options => new LocalSequentalTaskQueue(options),
})
