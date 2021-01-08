import { createTaskQueue, TaskInfo, TaskQueueBase, TaskQueueEventEmitter, TaskQueueOptions } from '@era-ci/core'
import { startWorker, Worker, WorkerTask } from '@era-ci/task-worker'
import { DoneResult, ExecutionStatus, Status } from '@era-ci/utils'
import { queue } from 'async'
import Queue from 'bee-queue'
import chance from 'chance'
import { EventEmitter } from 'events'
import { serializeError } from 'serialize-error'

export type TaskWorkerTaskQueueConfigurations = {
  queueName: string
  redis: {
    url: string
    auth?: {
      // username is not supported in bee-queue because bee-queue uses redis and it doesn't support redis-acl:
      // https://github.com/NodeRedis/node-redis/issues/1451
      // in next-major version of bee-queue, they will move to ioredis so then we can use "username".
      password?: string
    }
  }
}

export class TaskWorkerTaskQueue implements TaskQueueBase<TaskWorkerTaskQueueConfigurations, WorkerTask> {
  public readonly eventEmitter: TaskQueueEventEmitter<WorkerTask> = new EventEmitter({ captureRejections: true })
  private isQueueActive = true
  private readonly cleanups: (() => Promise<unknown>)[] = []
  private readonly queue: Queue<WorkerTask>
  // we use this task-queue to track on non-blocking-functions (promises we don't await for) and wait for all in the cleanup.
  // why we don't await on every function (instead of using this queue): because we want to emit events after functions returns
  private readonly internalTaskQueue = queue<() => Promise<unknown>>(
    (task, done) => task().then(() => done(), done),
    10,
  )
  private readonly tasks = new Map<string, TaskInfo<WorkerTask>>()

  constructor(private readonly options: TaskQueueOptions<TaskWorkerTaskQueueConfigurations>, readonly worker: Worker) {
    this.eventEmitter.setMaxListeners(Infinity)
    this.queue = new Queue<WorkerTask>(options.taskQueueConfigurations.queueName, {
      redis: {
        url: options.taskQueueConfigurations.redis.url,
        password: options.taskQueueConfigurations.redis.auth?.password,
      },
      removeOnSuccess: true,
      removeOnFailure: true,
    })

    this.cleanups.push(worker.cleanup)

    options.log.verbose(`initialized ${TaskWorkerTaskQueue.name}`)
  }

  public addTasksToQueue(tasksOptions: (WorkerTask & { taskName: string })[]): TaskInfo<WorkerTask>[] {
    if (!this.isQueueActive) {
      throw new Error(`task-queue was destroyed so you can not add new tasks to it`)
    }

    return tasksOptions.map(taskOption => {
      const task = this.queue.createJob({
        shellCommand: taskOption.shellCommand,
        cwd: taskOption.cwd,
      })

      const taskInfo: TaskInfo<WorkerTask> = {
        taskId: chance().hash().slice(0, 8),
        taskName: taskOption.taskName,
        payload: taskOption,
      }
      this.tasks.set(taskInfo.taskId, taskInfo)

      this.internalTaskQueue.push(async () => {
        this.eventEmitter.emit(ExecutionStatus.scheduled, {
          taskExecutionStatus: ExecutionStatus.scheduled,
          taskInfo,
          taskResult: {
            executionStatus: ExecutionStatus.scheduled,
          },
        })

        task.once('progress', () => {
          this.eventEmitter.emit(ExecutionStatus.running, {
            taskExecutionStatus: ExecutionStatus.running,
            taskInfo,
            taskResult: {
              executionStatus: ExecutionStatus.running,
            },
          })
        })

        task.once('succeeded', (result: DoneResult) => {
          this.eventEmitter.emit(ExecutionStatus.done, {
            taskExecutionStatus: ExecutionStatus.done,
            taskInfo,
            taskResult: result,
          })
        })

        task.once('failed', error => {
          this.eventEmitter.emit(ExecutionStatus.aborted, {
            taskExecutionStatus: ExecutionStatus.aborted,
            taskInfo,
            taskResult: {
              executionStatus: ExecutionStatus.aborted,
              status: Status.failed,
              durationMs: 1,
              errors: [serializeError(error)],
              notes: [],
            },
          })
        })

        await task.save()
      })

      this.options.log.verbose(`created task-id: "${taskInfo.taskId}" for task: "${taskOption.taskName}"`)
      return taskInfo
    })
  }

  public async cleanup(): Promise<void> {
    if (!this.isQueueActive) {
      return
    }

    this.isQueueActive = false
    this.options.log.verbose(`closing quay-builds task-queue and aborting scheduled and running tasks`)

    if (!this.internalTaskQueue.idle()) {
      // drain will not resolve if the queue is empty so we drain if it's not empty
      await this.internalTaskQueue.drain()
    }
    this.internalTaskQueue.kill()

    await Promise.allSettled(this.cleanups.map(f => f()))

    // TODO: wait until all tasks are finished, add timeout, report on "waiting" tasks as aborted.

    await this.queue.destroy() // delete all relevant keys from redis
    await this.queue.close()
    this.eventEmitter.removeAllListeners()

    this.options.log.verbose(`closed quay-builds task-queue and aborted scheduled and running tasks`)
  }
}

export const taskWorkerTaskQueue = createTaskQueue<TaskWorkerTaskQueue, WorkerTask, TaskWorkerTaskQueueConfigurations>({
  taskQueueName: 'task-worker-task-queue',
  initializeTaskQueue: async options => {
    const worker = await startWorker(
      {
        queueName: options.taskQueueConfigurations.queueName,
        repoPath: options.repoPath,
        maxWaitMsWithoutTasks: 1_000_000_000,
        maxWaitMsUntilFirstTask: 1_000_000_000,
        redis: options.taskQueueConfigurations.redis,
      },
      options.logger,
    )
    return new TaskWorkerTaskQueue(options, worker)
  },
})
