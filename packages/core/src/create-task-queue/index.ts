import { fromEvent, merge, Observable, of, throwError } from 'rxjs'
import { concatMap, filter, takeWhile } from 'rxjs/operators'
import { ExecutionStatus, Status } from '@era-ci/utils'
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
  TaskQueue extends TaskQueueBase<NormalizedTaskQueueConfigurations, WorkerTask>,
  WorkerTask,
  TaskQueueConfigurations = void,
  NormalizedTaskQueueConfigurations = TaskQueueConfigurations
>(createTaskQueueOptions: {
  normalizeTaskQueueConfigurations?: (options: {
    taskQueueConfigurations: TaskQueueConfigurations
  }) => Promise<NormalizedTaskQueueConfigurations>
  taskQueueName: string
  initializeTaskQueue: (options: TaskQueueOptions<NormalizedTaskQueueConfigurations>) => Promise<TaskQueue>
}): ConfigureTaskQueue<TaskQueueConfigurations, TaskQueue, WorkerTask> {
  return (taskQueueConfigurations: TaskQueueConfigurations) => ({
    taskQueueName: createTaskQueueOptions.taskQueueName,
    createFunc: async ({ logger, log, gitRepoInfo, repoPath, processEnv, redisClient }) => {
      // @ts-ignore - we need to find a way to ensure that if NormalizedTaskQueueConfigurations is defined, also normalizedTaskQueueConfigurations is defined.
      const normalizedTaskQueueConfigurations: NormalizedTaskQueueConfigurations = createTaskQueueOptions.normalizeTaskQueueConfigurations
        ? await createTaskQueueOptions.normalizeTaskQueueConfigurations({ taskQueueConfigurations })
        : taskQueueConfigurations
      return createTaskQueueOptions.initializeTaskQueue({
        taskQueueConfigurations: normalizedTaskQueueConfigurations,
        log,
        logger,
        gitRepoInfo,
        repoPath,
        processEnv,
        redisClient,
      })
    },
  })
}

export function toTaskEvent$<TaskPayload>(
  taskId: string,
  options: {
    eventEmitter: TaskQueueEventEmitter<TaskPayload>
    throwOnTaskNotPassed: boolean
  },
): Observable<
  ScheduledTask<TaskPayload> | RunningTask<TaskPayload> | AbortedTask<TaskPayload> | DoneTask<TaskPayload>
> {
  return merge(
    fromEvent<ScheduledTask<TaskPayload>>(options.eventEmitter, ExecutionStatus.scheduled),
    fromEvent<RunningTask<TaskPayload>>(options.eventEmitter, ExecutionStatus.running),
    fromEvent<AbortedTask<TaskPayload>>(options.eventEmitter, ExecutionStatus.aborted),
    fromEvent<DoneTask<TaskPayload>>(options.eventEmitter, ExecutionStatus.done),
  ).pipe(
    filter(e => e.taskInfo.taskId === taskId),
    takeWhile(e => ![ExecutionStatus.aborted, ExecutionStatus.done].includes(e.taskExecutionStatus), true),
    concatMap(e => {
      if (!options?.throwOnTaskNotPassed) {
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
