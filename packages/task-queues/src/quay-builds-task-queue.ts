import {
  createTaskQueue,
  TaskInfo,
  TaskQueueBase,
  TaskQueueEventEmitter,
  TaskQueueOptions,
  TaskTimeoutEventEmitter,
} from '@era-ci/core'
import { ExecutionStatus, Status } from '@era-ci/utils'
import { queue } from 'async'
import chance from 'chance'
import { EventEmitter } from 'events'
import fs from 'fs'
import { CancelError } from 'got'
import Redis from 'ioredis'
import path from 'path'
import { ErrorObject, serializeError } from 'serialize-error'
import {
  AbortEventHandler,
  BuildTriggerResult,
  QuayBuildStatus,
  QuayClient,
  QuayNotificationEvents,
} from '@era-ci/quay-client'

export { QuayBuildStatus, QuayNotificationEvents } from '@era-ci/quay-client'

export type QuayBuildsTaskQueueConfigurations = {
  redisAddress: string
  quayAddress: 'https://quay.io' | string
  quayServiceHelperAddress: string
  quayToken: string
  quayNamespace: string
  getCommitTarGzPublicAddress: (options: {
    repoNameWithOrgName: string
    gitCommit: string
    gitAuth?: {
      username?: string
      token?: string
    }
  }) => string
}

export const QUAY_BUILD_STATUS_CHANED_REDIS_TOPIC = 'quayBuildStatusChangedRedisTopic'

export type QuayBuildStatusChangedTopicPayload = {
  quayBuildId: string
  quayBuildStatus: QuayBuildStatus
  changeDateMs: number
}

type Task = {
  relativeContextPath: string
  relativeDockerfilePath: string
  imageTags: string[]
  taskTimeoutMs: number
  startTaskMs: number
  taskInfo: TaskInfo
  packageName: string
  quayRepoName: string
  quayRepoVisibility: 'private' | 'public'
  quayBuildName?: string
  quayBuildId?: string
  quayBuildAddress?: string
  quayBuildLogsAddress?: string
  lastKnownQuayBuildStatus?: string
  lastEmittedTaskExecutionStatus?: ExecutionStatus
}

export class QuayBuildsTaskQueue implements TaskQueueBase<QuayBuildsTaskQueueConfigurations> {
  public readonly eventEmitter: TaskQueueEventEmitter = new EventEmitter({ captureRejections: true })
  public readonly taskTimeoutEventEmitter: TaskTimeoutEventEmitter = new EventEmitter({ captureRejections: true })
  private readonly tasks: Map<string, Task> = new Map()
  private isQueueActive = true
  private queueStatusChanged: AbortEventHandler = new EventEmitter({
    captureRejections: true,
  })
  private readonly quayClient: QuayClient
  // we use this task-queue to track on non-blocking-functions (promises we don't await for) and wait for all in the cleanup.
  // why we don't await on every function (instead of using this queue): because we want to emit events after functions returns
  private readonly internalTaskQueue = queue<() => Promise<unknown>>(
    (task, done) => task().then(() => done(), done),
    10,
  )
  private readonly cleanups: (() => Promise<unknown>)[] = []

  constructor(
    private readonly options: TaskQueueOptions<QuayBuildsTaskQueueConfigurations>,
    private readonly redisConnection: Redis.Redis,
  ) {
    this.internalTaskQueue.error(error => options.log.error(`failed to run a task in internalTaskQueue`, error))
    this.eventEmitter.setMaxListeners(Infinity)
    this.quayClient = new QuayClient(
      this.taskTimeoutEventEmitter,
      this.queueStatusChanged,
      options.taskQueueConfigurations.quayAddress,
      options.taskQueueConfigurations.quayToken,
      options.taskQueueConfigurations.quayNamespace,
      options.log,
    )
    this.taskTimeoutEventEmitter.on('timeout', async taskId => {
      const task = this.tasks.get(taskId)
      if (!task) {
        throw new Error(`taskId not found: "${taskId}"`)
      }

      if (
        task.lastEmittedTaskExecutionStatus === ExecutionStatus.aborted ||
        task.lastEmittedTaskExecutionStatus === ExecutionStatus.done
      ) {
        return
      }

      if (task.quayBuildId) {
        await this.quayClient
          .cancelBuild({
            taskId: task.taskInfo.taskId,
            packageName: task.packageName,
            quayBuildId: task.quayBuildId,
          })
          .catch(() => {
            // the build maybe was not triggered
          })
      }
      task.lastEmittedTaskExecutionStatus = ExecutionStatus.aborted
      this.eventEmitter.emit(ExecutionStatus.aborted, {
        taskExecutionStatus: ExecutionStatus.aborted,
        taskInfo: task.taskInfo,
        taskResult: {
          executionStatus: ExecutionStatus.aborted,
          durationMs: Date.now() - task.startTaskMs,
          errors: [],
          notes: [`task-timeout`],
          status: Status.failed,
        },
      })
    })
    this.redisConnection.on('message', (topic: string, eventString: string) =>
      this.internalTaskQueue.push(() => this.onQuayBuildStatusChanged(topic, eventString)),
    )

    options.log.verbose(`initialized ${QuayBuildsTaskQueue.name}`)
  }

  private isTaskTimeout(
    options:
      | {
          taskId: string
        }
      | {
          quayBuildId: string
        }
      | {
          startTaskMs: number
          taskTimeoutMs: number
        },
  ): boolean {
    if ('quayBuildId' in options) {
      const task = Array.from(this.tasks.values()).find(b => b.quayBuildId === options.quayBuildId)
      if (!task) {
        throw new Error(`quayBuildId not found: "${options.quayBuildId}"`)
      }
      return this.isTaskTimeout({ startTaskMs: task.startTaskMs, taskTimeoutMs: task.taskTimeoutMs })
    } else {
      if ('taskId' in options) {
        const task = this.tasks.get(options.taskId)
        if (!task) {
          throw new Error(`taskId not found: "${options.taskId}"`)
        }
        return this.isTaskTimeout({ startTaskMs: task.startTaskMs, taskTimeoutMs: task.taskTimeoutMs })
      } else {
        return options.taskTimeoutMs < Date.now() - options.startTaskMs
      }
    }
  }

  private async onQuayBuildStatusChanged(topic: string, eventString: string, retry = 0): Promise<void> {
    const event: QuayBuildStatusChangedTopicPayload = JSON.parse(eventString)
    if (!this.isQueueActive) {
      this.options.log.debug(
        `task-queue is closed. ignoring new event on topic: "${topic}" from quay-server: ${JSON.stringify(
          event,
          null,
          2,
        )}`,
      )
      return
    }
    this.options.log.debug(`new event on topic: "${topic}" from quay-server: ${JSON.stringify(event, null, 2)}`)
    const task = Array.from(this.tasks.values()).find(b => b.quayBuildId === event.quayBuildId)
    if (!task) {
      if (retry >= 30) {
        this.options.log.error(`can't find build-id: "${event.quayBuildId}" which we received from quay-helper-service`)
      }
      // quay sent us a quay-build-id: "${event.quayBuildId}" which we don't know.
      // it means that quay gave us build-id in the REST-POST /build but we didn't process it yet and
      // then quay sent us notification about this build-id. let's process this event again with a delay of 1 second.
      await new Promise(res => setTimeout(res, 1000))
      return this.onQuayBuildStatusChanged(topic, eventString)
    }

    if (
      task.lastEmittedTaskExecutionStatus === ExecutionStatus.aborted ||
      task.lastEmittedTaskExecutionStatus === ExecutionStatus.done
    ) {
      return
    }

    task.lastKnownQuayBuildStatus = event.quayBuildStatus

    if (event.quayBuildStatus === 'complete') {
      task.lastEmittedTaskExecutionStatus = ExecutionStatus.done
      this.eventEmitter.emit(ExecutionStatus.done, {
        taskExecutionStatus: ExecutionStatus.done,
        taskInfo: task.taskInfo,
        taskResult: {
          executionStatus: ExecutionStatus.done,
          durationMs: Date.now() - task.startTaskMs,
          errors: [],
          notes: [],
          status: Status.passed,
        },
      })
      return
    }
    if (event.quayBuildStatus === 'error') {
      task.lastEmittedTaskExecutionStatus = ExecutionStatus.done
      this.eventEmitter.emit(ExecutionStatus.done, {
        taskExecutionStatus: ExecutionStatus.done,
        taskInfo: task.taskInfo,
        taskResult: {
          executionStatus: ExecutionStatus.done,
          durationMs: Date.now() - task.startTaskMs,
          errors: [],
          notes: [`build-logs: "${task.quayBuildLogsAddress}"`],
          status: Status.failed,
        },
      })
      return
    }
  }

  public addTasksToQueue(
    tasksOptions: {
      packageName: string
      repoName: string
      visibility: 'public' | 'private'
      relativeContextPath: string
      relativeDockerfilePath: string
      imageTags: string[]
      taskTimeoutMs: number
    }[],
  ): TaskInfo[] {
    const startTaskMs = Date.now()
    if (!this.isQueueActive) {
      throw new Error(`task-queue was destroyed so you can not add new tasks to it`)
    }

    const tasks: TaskInfo[] = []

    for (const taskOptions of tasksOptions) {
      const p1 = path.join(this.options.repoPath, taskOptions.relativeContextPath)
      if (!fs.existsSync(p1)) {
        throw new Error(
          `relativeContextPath can't be resolved in the file-system. received: "${taskOptions.relativeContextPath}", can't resolve path: ${p1}`,
        )
      }
      const p2 = path.join(this.options.repoPath, taskOptions.relativeDockerfilePath)
      if (!fs.existsSync(p2)) {
        throw new Error(
          `relativeDockerfilePath can't be resolved in the file-system. received: "${taskOptions.relativeDockerfilePath}", can't resolve path: ${p1}`,
        )
      }
      if (fs.lstatSync(p2).isDirectory()) {
        throw new Error(
          `relativeDockerfilePath points to a direcotry instead of a dockerfile. received: "${taskOptions.relativeDockerfilePath}"`,
        )
      }

      const taskInfo: TaskInfo = {
        taskName: `${taskOptions.packageName}-docker-image`,
        // for now, we support triggering a build on the same image+tag multiple
        // times because maybe the caller may have retry algorithm so the taskId must be random.
        // later on, we may stop supporting it and the taskId will be deterministic to make sure
        // that we don't trigger the same build multiple times. and the task-ids will be saved in redis(?).
        taskId: chance().hash().slice(0, 8),
      }

      tasks.push(taskInfo)

      const task: Task = {
        ...taskOptions,
        lastEmittedTaskExecutionStatus: ExecutionStatus.running,
        startTaskMs,
        taskInfo,
        quayRepoName: taskOptions.repoName,
        quayRepoVisibility: taskOptions.visibility,
      }

      this.tasks.set(taskInfo.taskId, task)

      const id = setTimeout(
        () => this.taskTimeoutEventEmitter.emit('timeout', taskInfo.taskId),
        taskOptions.taskTimeoutMs,
      )
      this.cleanups.push(async () => clearTimeout(id))

      this.internalTaskQueue.push(() => this.buildImage(task))

      this.options.log.verbose(
        `created task: "${taskInfo.taskId}" to build docker-image for package: "${taskOptions.packageName}"`,
      )
    }

    return tasks
  }

  public getBuildLogsAddress(taskId: string): string | undefined {
    const task = this.tasks.get(taskId)
    if (!task) {
      throw new Error(`taskId: ${taskId} not found`)
    }
    return task.quayBuildLogsAddress
  }

  private async buildImage(task: Task): Promise<void> {
    this.options.log.trace(`starting to process task: "${task.taskInfo.taskId}"`)
    const sendAbortEvent = (options: { notes: string[]; errors: ErrorObject[] }) => {
      if (
        task.lastEmittedTaskExecutionStatus === ExecutionStatus.aborted ||
        task.lastEmittedTaskExecutionStatus === ExecutionStatus.done
      ) {
        return
      }
      task.lastEmittedTaskExecutionStatus = ExecutionStatus.aborted
      this.eventEmitter.emit(ExecutionStatus.aborted, {
        taskExecutionStatus: ExecutionStatus.aborted,
        taskInfo: task.taskInfo,
        taskResult: {
          executionStatus: ExecutionStatus.aborted,
          durationMs: Date.now() - task.startTaskMs,
          status: Status.skippedAsFailed,
          ...options,
        },
      })
    }

    // if the queue closed after the user added new task, we will emit scheduled-event.
    task.lastEmittedTaskExecutionStatus = ExecutionStatus.scheduled
    this.eventEmitter.emit(ExecutionStatus.scheduled, {
      taskExecutionStatus: ExecutionStatus.scheduled,
      taskInfo: task.taskInfo,
      taskResult: {
        executionStatus: ExecutionStatus.scheduled,
      },
    })

    if (!this.isQueueActive) {
      sendAbortEvent({ notes: [`task-queue was closed. aborting quay-build`], errors: [] })
      return
    }
    if (this.isTaskTimeout({ taskId: task.taskInfo.taskId })) {
      sendAbortEvent({ notes: [`task-timeout`], errors: [] })
      return
    }
    task.lastEmittedTaskExecutionStatus = ExecutionStatus.running
    this.eventEmitter.emit(ExecutionStatus.running, {
      taskExecutionStatus: ExecutionStatus.running,
      taskInfo: task.taskInfo,
      taskResult: {
        executionStatus: ExecutionStatus.running,
      },
    })

    let buildTriggerResult: BuildTriggerResult | undefined
    try {
      await this.quayClient.createRepo({
        taskId: task.taskInfo.taskId,
        repoName: task.quayRepoName,
        visibility: task.quayRepoVisibility,
        packageName: task.packageName,
      })
      if (!this.isQueueActive) {
        sendAbortEvent({ notes: [`task-queue was closed. aborting quay-build`], errors: [] })
        return
      }
      if (this.isTaskTimeout({ taskId: task.taskInfo.taskId })) {
        sendAbortEvent({ notes: [`task-timeout`], errors: [] })
        return
      }
      await Promise.all(
        Object.values(QuayNotificationEvents).map(event =>
          this.quayClient.createNotification({
            taskId: task.taskInfo.taskId,
            event,
            packageName: task.packageName,
            repoName: task.quayRepoName,
            webhookUrl: `${this.options.taskQueueConfigurations.quayServiceHelperAddress}/quay-build-notification/${event}`,
          }),
        ),
      )
      if (!this.isQueueActive) {
        sendAbortEvent({ notes: [`task-queue was closed. aborting quay-build`], errors: [] })
        return
      }
      if (this.isTaskTimeout({ taskId: task.taskInfo.taskId })) {
        sendAbortEvent({ notes: [`task-timeout`], errors: [] })
        return
      }
      buildTriggerResult = await this.quayClient.triggerBuild({
        taskId: task.taskInfo.taskId,
        packageName: task.packageName,
        imageTags: task.imageTags,
        relativeContextPath: task.relativeContextPath,
        relativeDockerfilePath: task.relativeDockerfilePath,
        gitRepoName: this.options.gitRepoInfo.repoName,
        quayRepoName: task.quayRepoName,
        archiveUrl: this.options.taskQueueConfigurations.getCommitTarGzPublicAddress({
          repoNameWithOrgName: this.options.gitRepoInfo.repoNameWithOrgName,
          gitCommit: this.options.gitRepoInfo.commit,
          gitAuth: {
            username: this.options.gitRepoInfo?.auth?.username,
            token: this.options.gitRepoInfo?.auth?.username,
          },
        }),
        commit: this.options.gitRepoInfo.commit,
      })

      this.tasks.set(task.taskInfo.taskId, {
        ...this.tasks.get(task.taskInfo.taskId),
        ...task,
        ...buildTriggerResult,
        lastEmittedTaskExecutionStatus: ExecutionStatus.running,
        lastKnownQuayBuildStatus: buildTriggerResult.quayBuildStatus,
      })
    } catch (error: unknown) {
      if (buildTriggerResult) {
        await this.quayClient
          .cancelBuild({
            taskId: task.taskInfo.taskId,
            packageName: task.packageName,
            quayBuildId: buildTriggerResult.quayBuildId,
          })
          .catch(() => {
            // the build maybe was not triggered
          })
      }
      if (error instanceof CancelError && !this.isQueueActive) {
        sendAbortEvent({ notes: [`task-queue was closed. aborting quay-build`], errors: [] })
        return
      }
      if (error instanceof CancelError && this.isTaskTimeout({ taskId: task.taskInfo.taskId })) {
        sendAbortEvent({ notes: [`task-timeout`], errors: [] })
        return
      }
      sendAbortEvent({ notes: [], errors: [serializeError(error)] })
      return
    }
  }

  public async cleanup(): Promise<void> {
    if (!this.isQueueActive) {
      return
    }

    this.options.log.verbose(`closing quay-builds task-queue and aborting scheduled and running tasks`)
    await Promise.allSettled(this.cleanups.map(f => f()))
    // ensure we don't send events of any processing or pending tasks
    this.isQueueActive = false
    this.queueStatusChanged.emit('closed')
    if (!this.internalTaskQueue.idle()) {
      // drain will not resolve if the queue is empty so we drain if it's not empty
      await this.internalTaskQueue.drain()
    }
    this.internalTaskQueue.kill()

    const scheduledAndRunningTasks = Array.from(this.tasks.values()).filter(
      b =>
        b.lastEmittedTaskExecutionStatus === ExecutionStatus.scheduled ||
        b.lastEmittedTaskExecutionStatus === ExecutionStatus.running,
    )

    scheduledAndRunningTasks.forEach(b => {
      b.lastEmittedTaskExecutionStatus = ExecutionStatus.aborted
      this.eventEmitter.emit(ExecutionStatus.aborted, {
        taskExecutionStatus: ExecutionStatus.aborted,
        taskInfo: b.taskInfo,
        taskResult: {
          executionStatus: ExecutionStatus.aborted,
          status: Status.skippedAsFailed,
          durationMs: Date.now() - b.startTaskMs,
          errors: [],
          notes: [`queue closed. aborting`],
        },
      })
    })

    this.eventEmitter.removeAllListeners()
    this.taskTimeoutEventEmitter.removeAllListeners()

    await this.redisConnection.disconnect()

    // all tasks will end now and each running task will send "aborted" event.

    this.options.log.verbose(`closed quay-builds task-queue and aborted scheduled and running tasks`)
  }
}

export const quayBuildsTaskQueue = createTaskQueue<QuayBuildsTaskQueue, QuayBuildsTaskQueueConfigurations>({
  taskQueueName: 'quay-builds-task-queue',
  initializeTaskQueue: async options => {
    const redisConnection = new Redis(options.taskQueueConfigurations.redisAddress, { lazyConnect: true })
    await redisConnection.connect()
    await redisConnection.subscribe(
      // eslint-disable-next-line no-process-env
      process.env.QUAY_BUILD_STATUS_CHANED_TEST_REDIS_TOPIC || QUAY_BUILD_STATUS_CHANED_REDIS_TOPIC,
    )
    return new QuayBuildsTaskQueue(options, redisConnection)
  },
})
