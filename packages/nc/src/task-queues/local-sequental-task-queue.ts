import { ErrorCallback, queue } from 'async'
import chance from 'chance'
import { EventEmitter } from 'events'
import { CreateTaskQueue, createTaskQueue, ScheduledTask, TaskInfo, TaskQueueEventEmitter } from '../create-task-queue'
import { ExecutionStatus, Status } from '../types'

export type LocalSequentalTaskQueueName = 'local-sequental-task-queue'
// we must specify the type to be specfic string or the user-configuration will think that the type is string
export const localSequentalTaskQueueName: LocalSequentalTaskQueueName = 'local-sequental-task-queue'

export type LocalSequentalTaskQueue = {
  taskQueueName: LocalSequentalTaskQueueName
  cleanup: () => Promise<unknown>
  addTasksToQueue: (tasksOptions: { taskName: string; func: () => Promise<void> }[]) => Promise<ScheduledTask[]>
  eventEmitter: TaskQueueEventEmitter
}

type ProccessedTask = { taskInfo: TaskInfo; func: () => Promise<void> }

const startTask = (eventEmitter: TaskQueueEventEmitter, queueState: { isQueueKilled: boolean }) => async (
  task: ProccessedTask,
  cb: ErrorCallback,
) => {
  const startTimeMs = Date.now()
  if (queueState.isQueueKilled) {
    return
  }
  eventEmitter.emit(ExecutionStatus.running, {
    taskExecutionStatus: ExecutionStatus.running,
    taskInfo: task.taskInfo,
    taskResult: {
      executionStatus: ExecutionStatus.running,
    },
  })
  await task.func().then(
    () =>
      !queueState.isQueueKilled &&
      eventEmitter.emit(ExecutionStatus.done, {
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
      !queueState.isQueueKilled &&
      eventEmitter.emit(ExecutionStatus.done, {
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

export type CreateLocalSequentalTaskQueue = (
  taskQueueConfigurations: void,
) => CreateTaskQueue<LocalSequentalTaskQueueName, LocalSequentalTaskQueue>

export const localSequentalTaskQueue = createTaskQueue<LocalSequentalTaskQueueName, LocalSequentalTaskQueue>({
  taskQueueName: localSequentalTaskQueueName,
  initializeTaskQueue: async ({ log }) => {
    log.verbose(`initializing local-sequental task-queue`)
    const eventEmitter: TaskQueueEventEmitter = new EventEmitter({
      captureRejections: true,
    })
    const queueState = { isQueueKilled: false }
    const taskQueue = queue(startTask(eventEmitter, queueState), 1)

    log.verbose(`initialized local-sequental task-queue`)
    return {
      taskQueueName: localSequentalTaskQueueName,
      addTasksToQueue: async tasksOptions => {
        const result: ScheduledTask[] = []

        for (const taskOptions of tasksOptions) {
          const taskInfo: TaskInfo = {
            taskName: taskOptions.taskName,
            taskId: chance().hash(),
          }

          taskQueue.push<ProccessedTask, unknown>({ taskInfo, func: taskOptions.func })
          result.push({
            taskExecutionStatus: ExecutionStatus.scheduled,
            taskInfo,
            taskResult: {
              executionStatus: ExecutionStatus.scheduled,
            },
          })
          // this line will be executed before async.queue will
          // process the task so we can be sure that `scheduled` is the first event.
          eventEmitter.emit(ExecutionStatus.scheduled, result[result.length - 1])
        }

        return result
      },
      eventEmitter,
      cleanup: async () => {
        log.verbose(`closing local-sequental task-queue and aborting scheduled tasks`)
        // ensure we don't send events of any processing or pending tasks
        queueState.isQueueKilled = true
        taskQueue.pause()
        // @ts-ignore - taskQueue is iterable so the types are wrong
        for (const t of [...taskQueue, ...taskQueue.workersList()]) {
          const task: ProccessedTask = t
          eventEmitter.emit(ExecutionStatus.aborted, {
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
        taskQueue.kill()
        log.verbose(`closed local-sequental task-queue and aborted scheduled tasks`)
      },
    }
  },
})
