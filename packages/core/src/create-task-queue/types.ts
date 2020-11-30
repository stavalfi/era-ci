import { EventEmitter } from 'events'
import { StrictEventEmitter } from 'strict-event-emitter-types'
import { Log, Logger } from '../create-logger'
import {
  AbortResult,
  DoneResult,
  ExecutionStatus,
  GitRepoInfo,
  RunningResult,
  ScheduledResult,
  Status,
} from '@tahini/utils'

export type TaskInfo = {
  taskName: string
  taskId: string
}

export type DoneTask = {
  taskExecutionStatus: ExecutionStatus.done
  taskInfo: TaskInfo
  taskResult: DoneResult
}

export type AbortedTask = {
  taskExecutionStatus: ExecutionStatus.aborted
  taskInfo: TaskInfo
  taskResult: AbortResult<Status.skippedAsFailed | Status.failed | Status.passed>
}

export type RunningTask = {
  taskExecutionStatus: ExecutionStatus.running
  taskInfo: TaskInfo
  taskResult: RunningResult
}

export type ScheduledTask = {
  taskExecutionStatus: ExecutionStatus.scheduled
  taskInfo: TaskInfo
  taskResult: ScheduledResult
}

export type EventEmitterEvents = {
  [ExecutionStatus.done]: (task: DoneTask) => void
  [ExecutionStatus.aborted]: (task: AbortedTask) => void
  [ExecutionStatus.running]: (task: RunningTask) => void
  [ExecutionStatus.scheduled]: (task: ScheduledTask) => void
}

export type TaskQueueEventEmitter = StrictEventEmitter<EventEmitter, EventEmitterEvents>
export type TaskTimeoutEventEmitter = StrictEventEmitter<
  EventEmitter,
  {
    timeout: (taskId: string) => void
  }
>

export type TaskQueueBase<
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  TaskQueueConfigurations // I need this for type usage
> = {
  readonly eventEmitter: TaskQueueEventEmitter
  cleanup: () => Promise<unknown>
}

export type CreateTaskQueue<
  TaskQueueConfigurations,
  TaskQueue extends TaskQueueBase<TaskQueueConfigurations>
> = (options: { log: Log; logger: Logger; gitRepoInfo: GitRepoInfo }) => Promise<TaskQueue>

export type ConfigureTaskQueue<TaskQueueConfigurations, TaskQueue extends TaskQueueBase<TaskQueueConfigurations>> = (
  taskQueueConfigurations: TaskQueueConfigurations,
) => {
  taskQueueName: string
  createFunc: CreateTaskQueue<TaskQueueConfigurations, TaskQueue>
}

export type TaskQueueOptions<TaskQueueConfigurations = void> = {
  taskQueueConfigurations: TaskQueueConfigurations
  log: Log
  logger: Logger
  gitRepoInfo: GitRepoInfo
}
