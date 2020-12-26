import { createTaskQueue, TaskInfo, TaskQueueBase, TaskQueueEventEmitter, TaskQueueOptions } from '@tahini/core'
import { queue } from 'async'
import chance from 'chance'
import { EventEmitter } from 'events'

export type K8sJobTaskQueueConfigurations = {
  cardentials: string
}

export class K8sJobTaskQueue implements TaskQueueBase<K8sJobTaskQueueConfigurations> {
  public readonly eventEmitter: TaskQueueEventEmitter = new EventEmitter({
    captureRejections: true,
  })
  private isQueueActive = true

  // we use this task-queue to track on non-blocking-functions (promises we don't await for) and wait for all in the cleanup.
  // why we don't await on every function (instead of using this queue): because we want to emit events after functions returns
  private readonly internalTaskQueue = queue<() => Promise<unknown>>(async (task, done) => {
    try {
      await task()
      done()
    } catch (error) {
      done(error)
    }
  }, 1)

  constructor(private readonly options: TaskQueueOptions<void>) {
    this.eventEmitter.setMaxListeners(Infinity)
    this.options.log.verbose(`initialized local-sequental task-queue`)
  }

  /**
   * this operation is not async to ensure that the caller can do other stuff before any of the tasks are executed
   * @param tasksOptions tasks array to preform
   */
  public addTasksToQueue(tasksOptions: { taskName: string }[]): TaskInfo[] {
    if (!this.isQueueActive) {
      throw new Error(
        `task-queue was destroyed so you can not add new tasks to it. ignored tasks-names: "${tasksOptions
          .map(t => t.taskName)
          .join(', ')}"`,
      )
    }

    const tasks: TaskInfo[] = tasksOptions.map(taskOptions => ({
      taskName: taskOptions.taskName,
      taskId: chance().hash().slice(0, 8),
    }))

    this.internalTaskQueue.push(async () => {
      //
    })

    return tasks
  }

  public async cleanup(): Promise<void> {
    if (!this.isQueueActive) {
      return
    }

    this.options.log.verbose(`closing k8s-job-task-queue and aborting scheduled tasks`)
    // ensure we don't send events of any processing or pending tasks
    this.isQueueActive = false

    this.eventEmitter.removeAllListeners()
    this.options.log.verbose(`closed k8s-job-task-queue and aborted scheduled tasks`)
  }
}

export const k8sJobTaskQueue = createTaskQueue<K8sJobTaskQueue>({
  taskQueueName: 'k8s-job-task-queue',
  initializeTaskQueue: async options => new K8sJobTaskQueue(options),
})
