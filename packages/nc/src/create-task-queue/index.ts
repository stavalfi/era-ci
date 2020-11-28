import { fromEvent, merge, Observable, of, throwError } from 'rxjs'
import { concatMap, takeWhile } from 'rxjs/operators'
import { ExecutionStatus, Status } from '../types'
import {
  AbortTask,
  ConfigureTaskQueue,
  DoneTask,
  RunningTask,
  ScheduledTask,
  TaskQueueBase,
  TaskQueueEventEmitter,
  TaskQueueOptions,
} from './types'

export {
  AbortTask,
  ConfigureTaskQueue,
  CreateTaskQueue,
  DoneTask,
  EventEmitterEvents,
  RunningTask,
  ScheduledTask,
  TaskInfo,
  TaskQueueBase,
  TaskQueueEventEmitter,
  TaskQueueOptions,
} from './types'

export function createTaskQueue<
  TaskQueue extends TaskQueueBase<NormalizedTaskQueueConfigurations>,
  TaskQueueConfigurations = void,
  NormalizedTaskQueueConfigurations = TaskQueueConfigurations
>(createTaskQueueOptions: {
  normalizeTaskQueueConfigurations?: (options: {
    taskQueueConfigurations: TaskQueueConfigurations
  }) => Promise<NormalizedTaskQueueConfigurations>
  taskQueueName: string
  initializeTaskQueue: (options: TaskQueueOptions<NormalizedTaskQueueConfigurations>) => Promise<TaskQueue>
}): ConfigureTaskQueue<TaskQueueConfigurations, TaskQueue> {
  return (taskQueueConfigurations: TaskQueueConfigurations) => ({
    taskQueueName: createTaskQueueOptions.taskQueueName,
    createFunc: async ({ logger, log, gitRepoInfo }) => {
      // @ts-ignore - we need to find a way to ensure that if NormalizedTaskQueueConfigurations is defined, also normalizedTaskQueueConfigurations is defined.
      const normalizedTaskQueueConfigurations: NormalizedTaskQueueConfigurations = createTaskQueueOptions.normalizeTaskQueueConfigurations
        ? await createTaskQueueOptions.normalizeTaskQueueConfigurations({ taskQueueConfigurations })
        : taskQueueConfigurations
      return createTaskQueueOptions.initializeTaskQueue({
        taskQueueConfigurations: normalizedTaskQueueConfigurations,
        log,
        logger,
        gitRepoInfo,
      })
    },
  })
}

export function toTaskQueueEvent$(
  eventEmitter: TaskQueueEventEmitter,
  options?: {
    errorOnTaskNotPassed?: boolean
  },
): Observable<ScheduledTask | RunningTask | AbortTask | DoneTask> {
  return merge(
    fromEvent<ScheduledTask>(eventEmitter, ExecutionStatus.scheduled, { once: true }),
    fromEvent<RunningTask>(eventEmitter, ExecutionStatus.running, { once: true }),
    fromEvent<AbortTask>(eventEmitter, ExecutionStatus.aborted, { once: true }),
    fromEvent<DoneTask>(eventEmitter, ExecutionStatus.done, { once: true }),
  ).pipe(
    takeWhile(e => ![ExecutionStatus.aborted, ExecutionStatus.done].includes(e.taskExecutionStatus), true),
    concatMap(e => {
      if (!options?.errorOnTaskNotPassed) {
        return of(e)
      }
      switch (e.taskExecutionStatus) {
        case ExecutionStatus.done:
          return [Status.passed, Status.skippedAsPassed].includes(e.taskResult.status) ? of(e) : throwError(e)
        case ExecutionStatus.aborted:
          return [Status.skippedAsPassed].includes(e.taskResult.status) ? of(e) : throwError(e)
        default:
          return of(e)
      }
    }),
  )
}
