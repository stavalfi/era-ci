import { createTaskQueue, TaskQueueBase, TaskQueueOptions } from '../create-task-queue'

export class ExampleTaskQueue implements TaskQueueBase<void> {
  constructor(private readonly options: TaskQueueOptions) {
    this.options.log.verbose(`initialized ${ExampleTaskQueue.name}`)
  }

  public async cleanup(): Promise<void> {
    return Promise.resolve()
  }
}

export const exampleTaskQueue = createTaskQueue<ExampleTaskQueue>({
  initializeTaskQueue: async options => new ExampleTaskQueue(options),
})
