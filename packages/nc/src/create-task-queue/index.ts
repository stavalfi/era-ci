import { fromEvent, merge, Observable, of, throwError } from 'rxjs'
import { concatMap, filter, takeWhile } from 'rxjs/operators'
import { ExecutionStatus, Status } from '../types'
import {
  AbortedTask,
  ConfigureTaskQueue,
  DoneTask,
  RunningTask,
  ScheduledTask,
  TaskQueueBase,
  TaskQueueEventEmitter,
  TaskQueueOptions,
} from './types'

export {
  AbortedTask,
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
  TaskTimeoutEventEmitter,
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

export function toTaskEvent$(
  taskId: string,
  options: {
    eventEmitter: TaskQueueEventEmitter
    errorOnTaskNotPassed?: boolean
  },
): Observable<ScheduledTask | RunningTask | AbortedTask | DoneTask> {
  return merge(
    fromEvent<ScheduledTask>(options.eventEmitter, ExecutionStatus.scheduled),
    fromEvent<RunningTask>(options.eventEmitter, ExecutionStatus.running),
    fromEvent<AbortedTask>(options.eventEmitter, ExecutionStatus.aborted),
    fromEvent<DoneTask>(options.eventEmitter, ExecutionStatus.done),
  ).pipe(
    filter(e => e.taskInfo.taskId === taskId),
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
