import { ConfigureTaskQueue, TaskQueueBase, TaskQueueOptions } from './types'

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
    createFunc: async ({ log, gitRepoInfo }) => {
      // @ts-ignore - we need to find a way to ensure that if NormalizedTaskQueueConfigurations is defined, also normalizedTaskQueueConfigurations is defined.
      const normalizedTaskQueueConfigurations: NormalizedTaskQueueConfigurations = createTaskQueueOptions.normalizeTaskQueueConfigurations
        ? await createTaskQueueOptions.normalizeTaskQueueConfigurations({ taskQueueConfigurations })
        : taskQueueConfigurations
      return createTaskQueueOptions.initializeTaskQueue({
        taskQueueConfigurations: normalizedTaskQueueConfigurations,
        log,
        gitRepoInfo,
      })
    },
  })
}
