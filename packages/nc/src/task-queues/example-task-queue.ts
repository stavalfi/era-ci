import { CreateTaskQueue, createTaskQueue } from '../create-task-queue'

export type ExampleTaskQueueName = 'example-task-queue'
// we must specify the type to be specfic string or the user-configuration will think that the type is string
export const exampleTaskQueueName: ExampleTaskQueueName = 'example-task-queue'

export type ExampleTaskQueue = {
  taskQueueName: ExampleTaskQueueName
  cleanup: () => Promise<unknown>
}

export type CreateExampleTaskQueue = (
  taskQueueConfigurations: void,
) => CreateTaskQueue<ExampleTaskQueueName, ExampleTaskQueue>

export const exampleTaskQueue = createTaskQueue<ExampleTaskQueueName, ExampleTaskQueue>({
  taskQueueName: exampleTaskQueueName,
  initializeTaskQueue: async () => {
    return {
      taskQueueName: exampleTaskQueueName,
      cleanup: async () => {
        return Promise.resolve()
      },
    }
  },
})
