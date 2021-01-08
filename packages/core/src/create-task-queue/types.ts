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
} from '@era-ci/utils'

export type TaskInfo<TaskPayload> = {
  taskName: string
  taskId: string
  payload: TaskPayload
}

export type DoneTask<TaskPayload> = {
  taskExecutionStatus: ExecutionStatus.done
  taskInfo: TaskInfo<TaskPayload>
  taskResult: DoneResult
}

export type AbortedTask<TaskPayload> = {
  taskExecutionStatus: ExecutionStatus.aborted
  taskInfo: TaskInfo<TaskPayload>
  taskResult: AbortResult<Status.skippedAsFailed | Status.skippedAsPassed | Status.failed>
}

export type RunningTask<TaskPayload> = {
  taskExecutionStatus: ExecutionStatus.running
  taskInfo: TaskInfo<TaskPayload>
  taskResult: RunningResult
}

export type ScheduledTask<TaskPayload> = {
  taskExecutionStatus: ExecutionStatus.scheduled
  taskInfo: TaskInfo<TaskPayload>
  taskResult: ScheduledResult
}

export type EventEmitterEvents<TaskPayload> = {
  [ExecutionStatus.done]: (task: DoneTask<TaskPayload>) => void
  [ExecutionStatus.aborted]: (task: AbortedTask<TaskPayload>) => void
  [ExecutionStatus.running]: (task: RunningTask<TaskPayload>) => void
  [ExecutionStatus.scheduled]: (task: ScheduledTask<TaskPayload>) => void
}

export type TaskQueueEventEmitter<TaskPayload> = StrictEventEmitter<EventEmitter, EventEmitterEvents<TaskPayload>>
export type TaskTimeoutEventEmitter = StrictEventEmitter<
  EventEmitter,
  {
    timeout: (taskId: string) => void
  }
>

export type TaskQueueBase<
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  TaskQueueConfigurations, // I need this for type usage
  TaskPayload
> = {
  readonly eventEmitter: TaskQueueEventEmitter<TaskPayload>
  cleanup: () => Promise<unknown>
}

export type CreateTaskQueue<
  TaskQueueConfigurations,
  TaskQueue extends TaskQueueBase<TaskQueueConfigurations, TaskPayload>,
  TaskPayload
> = (options: { log: Log; logger: Logger; gitRepoInfo: GitRepoInfo; repoPath: string }) => Promise<TaskQueue>

export type ConfigureTaskQueue<
  TaskQueueConfigurations,
  TaskQueue extends TaskQueueBase<TaskQueueConfigurations, TaskPayload>,
  TaskPayload
> = (
  taskQueueConfigurations: TaskQueueConfigurations,
) => {
  taskQueueName: string
  createFunc: CreateTaskQueue<TaskQueueConfigurations, TaskQueue, TaskPayload>
}

export type TaskQueueOptions<TaskQueueConfigurations = void> = {
  taskQueueConfigurations: TaskQueueConfigurations
  log: Log
  logger: Logger
  repoPath: string
  gitRepoInfo: GitRepoInfo
}
