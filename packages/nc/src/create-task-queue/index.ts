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
} from './types'

export function createTaskQueue<
  TaskQueueName,
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
}) {
  return (taskQueueConfigurations: TaskQueueConfigurations): CreateTaskQueue<TaskQueueName, TaskQueue> => ({
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
  })
}
