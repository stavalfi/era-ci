import { Log } from '../create-logger'
import { CreateTaskQueue, TaskQueue } from './types'

export {
  AbortTask,
  CreateTaskQueue,
  DoneTask,
  EventEmitterEvents,
  RunningTask,
  ScheduledTask,
  TaskInfo,
  TaskQueue,
  TaskQueueEventEmitter,
} from './types'

export function createTaskQueue<
  TaskData,
  TaskQueueConfigurations = void,
  NormalizedTaskQueueConfigurations = TaskQueueConfigurations
>(createTaskQueueOptions: {
  normalizeTaskQueueConfigurations?: (options: {
    TaskQueueConfigurations: TaskQueueConfigurations
  }) => Promise<NormalizedTaskQueueConfigurations>
  initializeTaskQueue: (options: {
    TaskQueueConfigurations: NormalizedTaskQueueConfigurations
    log: Log
  }) => Promise<TaskQueue<TaskData>>
}) {
  return (TaskQueueConfigurations: TaskQueueConfigurations): CreateTaskQueue<TaskData> => ({
    callInitializeTaskQueue: async ({ log }) => {
      // @ts-ignore - we need to find a way to ensure that if NormalizedTaskQueueConfigurations is defined, also normalizedTaskQueueConfigurations is defined.
      const normalizedTaskQueueConfigurations: NormalizedTaskQueueConfigurations = createTaskQueueOptions.normalizeTaskQueueConfigurations
        ? await createTaskQueueOptions.normalizeTaskQueueConfigurations({ TaskQueueConfigurations })
        : TaskQueueConfigurations
      return createTaskQueueOptions.initializeTaskQueue({
        TaskQueueConfigurations: normalizedTaskQueueConfigurations,
        log,
      })
    },
  })
}
