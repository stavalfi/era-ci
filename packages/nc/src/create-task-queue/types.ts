import { AbortResult, DoneResult, ExecutionStatus, RunningResult, ScheduledResult, Status } from '../types'
import { StrictEventEmitter } from 'strict-event-emitter-types'
import { EventEmitter } from 'events'
import { Log } from '../create-logger'

export type TaskInfo = {
  taskName: string
  taskId: string
}

export type DoneTask = {
  taskExecutionStatus: ExecutionStatus.done
  taskInfo: TaskInfo
  taskResult: DoneResult
}

export type AbortTask = {
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
  [ExecutionStatus.aborted]: (task: AbortTask) => void
  [ExecutionStatus.running]: (task: RunningTask) => void
  [ExecutionStatus.scheduled]: (task: ScheduledTask) => void
}

export type TaskQueueEventEmitter = StrictEventEmitter<EventEmitter, EventEmitterEvents>

export type TaskQueueBase<TaskQueueName> = { taskQueueName: TaskQueueName; cleanup: () => Promise<unknown> }

export type CreateTaskQueue<TaskQueueName, TaskQueue extends TaskQueueBase<TaskQueueName>> = {
  taskQueueName: TaskQueueName
  callInitializeTaskQueue: (options: { log: Log }) => Promise<TaskQueue>
}
