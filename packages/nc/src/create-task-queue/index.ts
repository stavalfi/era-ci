import { ConfigureTaskQueue, CreateTaskQueue, TaskQueueBase, TaskQueueOptions } from './types'

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
  initializeTaskQueue: (options: TaskQueueOptions<NormalizedTaskQueueConfigurations>) => Promise<TaskQueue>
}): ConfigureTaskQueue<TaskQueue, TaskQueueConfigurations> {
  return (
    taskQueueConfigurations: TaskQueueConfigurations,
  ): CreateTaskQueue<NormalizedTaskQueueConfigurations, TaskQueue> => async ({ log }) => {
    // @ts-ignore - we need to find a way to ensure that if NormalizedTaskQueueConfigurations is defined, also normalizedTaskQueueConfigurations is defined.
    const normalizedTaskQueueConfigurations: NormalizedTaskQueueConfigurations = createTaskQueueOptions.normalizeTaskQueueConfigurations
      ? await createTaskQueueOptions.normalizeTaskQueueConfigurations({ taskQueueConfigurations })
      : taskQueueConfigurations
    return createTaskQueueOptions.initializeTaskQueue({
      taskQueueConfigurations: normalizedTaskQueueConfigurations,
      log,
    })
  }
}
