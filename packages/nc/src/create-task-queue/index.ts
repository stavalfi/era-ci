import { Log } from '../create-logger'
import { CreateTaskQueue, TaskQueueBase } from './types'

export {
  AbortTask,
  CreateTaskQueue,
  DoneTask,
  EventEmitterEvents,
  RunningTask,
  ScheduledTask,
  TaskInfo,
  TaskQueueEventEmitter,
  TaskQueueBase,
} from './types'

export type ConfigureTaskQueue<
  TaskQueueName extends string,
  TaskQueue extends TaskQueueBase<TaskQueueName>,
  TaskQueueConfigurations
> = {
  taskQueueName: TaskQueueName
  configure: (taskQueueConfigurations: TaskQueueConfigurations) => CreateTaskQueue<TaskQueueName, TaskQueue>
}

export function createTaskQueue<
  TaskQueueName extends string,
  TaskQueue extends TaskQueueBase<TaskQueueName>,
  TaskQueueConfigurations = void,
  NormalizedTaskQueueConfigurations = TaskQueueConfigurations
>(createTaskQueueOptions: {
  normalizeTaskQueueConfigurations?: (options: {
    taskQueueConfigurations: TaskQueueConfigurations
  }) => Promise<NormalizedTaskQueueConfigurations>
  taskQueueName: TaskQueueName
  initializeTaskQueue: (options: {
    taskQueueConfigurations: NormalizedTaskQueueConfigurations
    log: Log
  }) => Promise<TaskQueue>
}): ConfigureTaskQueue<TaskQueueName, TaskQueue, TaskQueueConfigurations> {
  return {
    taskQueueName: createTaskQueueOptions.taskQueueName,
    configure: (taskQueueConfigurations: TaskQueueConfigurations): CreateTaskQueue<TaskQueueName, TaskQueue> => ({
      taskQueueName: createTaskQueueOptions.taskQueueName,
      callInitializeTaskQueue: async ({ log }) => {
        // @ts-ignore - we need to find a way to ensure that if NormalizedTaskQueueConfigurations is defined, also normalizedTaskQueueConfigurations is defined.
        const normalizedTaskQueueConfigurations: NormalizedTaskQueueConfigurations = createTaskQueueOptions.normalizeTaskQueueConfigurations
          ? await createTaskQueueOptions.normalizeTaskQueueConfigurations({ taskQueueConfigurations })
          : taskQueueConfigurations
        return createTaskQueueOptions.initializeTaskQueue({
          taskQueueConfigurations: normalizedTaskQueueConfigurations,
          log,
        })
      },
    }),
  }
}
