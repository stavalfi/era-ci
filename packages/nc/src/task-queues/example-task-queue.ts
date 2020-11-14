import { createTaskQueue, TaskQueueBase, TaskQueueOptions } from '../create-task-queue'

export type ExampleTaskQueueName = 'example-task-queue'

export class ExampleTaskQueue implements TaskQueueBase<ExampleTaskQueueName, void> {
  public readonly taskQueueName: ExampleTaskQueueName = 'example-task-queue'

  constructor(private readonly options: TaskQueueOptions) {
    this.options.log.verbose(`initialized example task-queue`)
  }

  public async cleanup(): Promise<void> {
    return Promise.resolve()
  }
}

export const exampleTaskQueue = createTaskQueue<ExampleTaskQueueName, ExampleTaskQueue>({
  taskQueueName: 'example-task-queue',
  initializeTaskQueue: async options => new ExampleTaskQueue(options),
})
