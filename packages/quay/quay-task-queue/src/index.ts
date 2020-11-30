import {
  createTaskQueue,
  ExecutionStatus,
  Status,
  TaskInfo,
  TaskQueueBase,
  TaskQueueEventEmitter,
  TaskQueueOptions,
  TaskTimeoutEventEmitter,
} from '@tahini/nc'
import { queue } from 'async'
import chance from 'chance'
import { EventEmitter } from 'events'
import { CancelError } from 'got'
import Redis from 'ioredis'
import { serializeError } from 'serialize-error'
import { BuildTriggerResult, QuayBuildStatus, QuayClient, QuayNotificationEvents } from './quay-client'
import { AbortEventHandler } from './types'

export { QuayBuildStatus, QuayNotificationEvents } from './quay-client'

export type QuayBuildsTaskQueueConfigurations = {
  redisAddress: string
  quayAddress: 'https://quay.io' | string
  quayServiceHelperAddress: string
  quayToken: string
  quayNamespace: string
  getQuayRepoInfo: (packageName: string) => { repoName: string; visibility: 'public' | 'private' }
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

export class QuayBuildsTaskQueue implements TaskQueueBase<QuayBuildsTaskQueueConfigurations> {
  public readonly eventEmitter: TaskQueueEventEmitter = new EventEmitter({ captureRejections: true })
  public readonly taskTimeoutEventEmitter: TaskTimeoutEventEmitter = new EventEmitter({ captureRejections: true })
  private readonly tasks: Map<
    string,
    {
      taskTimeoutMs: number
      startTaskMs: number
      taskInfo: TaskInfo
      packageName: string
      quayRepoName: string
      quayBuildName: string
      quayBuildId: string
      quayBuildAddress: string
      quayBuildLogsAddress: string
      lastKnownQuayBuildStatus: string
      lastEmittedTaskExecutionStatus: ExecutionStatus
    }
  > = new Map()
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
      this.eventEmitter.emit(ExecutionStatus.aborted, {
        taskExecutionStatus: ExecutionStatus.aborted,
        taskInfo: task.taskInfo,
        taskResult: {
          executionStatus: ExecutionStatus.aborted,
          durationMs: Date.now() - task.startTaskMs,
          errors: [],
          notes: [`task timeout`],
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
    task.lastKnownQuayBuildStatus = event.quayBuildStatus

    if (event.quayBuildStatus === 'complete') {
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

    const tasks: TaskInfo[] = tasksOptions.map(t => ({
      taskName: `${t.packageName}-docker-image`,
      // for now, we support triggering a build on the same image+tag multiple
      // times because maybe the caller may have retry algorithm so the taskId must be random.
      // later on, we may stop supporting it and the taskId will be deterministic to make sure
      // that we don't trigger the same build multiple times. and the task-ids will be saved in redis(?).
      taskId: chance().hash(),
    }))

    tasks.forEach((task, i) => {
      const id = setTimeout(
        () => this.taskTimeoutEventEmitter.emit('timeout', task.taskId),
        tasksOptions[i].taskTimeoutMs,
      )
      this.cleanups.push(async () => clearTimeout(id))
    })

    this.internalTaskQueue.push(() =>
      Promise.all(tasksOptions.map((t, i) => this.buildImage({ ...t, taskInfo: tasks[i], startTaskMs }))),
    )

    return tasks
  }

  public getBuildLogsAddress(taskId: string): string {
    const task = this.tasks.get(taskId)
    if (!task) {
      throw new Error(`taskId: ${taskId} not found`)
    }
    return task.quayBuildLogsAddress
  }

  private async buildImage({
    startTaskMs,
    packageName,
    imageTags,
    relativeContextPath,
    relativeDockerfilePath,
    taskInfo,
    taskTimeoutMs,
  }: {
    taskInfo: TaskInfo
    startTaskMs: number
    packageName: string
    relativeContextPath: string
    relativeDockerfilePath: string
    imageTags: string[]
    taskTimeoutMs: number
  }): Promise<void> {
    const sendAbortEvent = (note: string) =>
      this.eventEmitter.emit(ExecutionStatus.aborted, {
        taskExecutionStatus: ExecutionStatus.aborted,
        taskInfo,
        taskResult: {
          executionStatus: ExecutionStatus.aborted,
          durationMs: Date.now() - startTaskMs,
          errors: [],
          notes: [note],
          status: Status.skippedAsFailed,
        },
      })

    // if the queue closed after the user added new task, we will emit scheduled-event.
    this.eventEmitter.emit(ExecutionStatus.scheduled, {
      taskExecutionStatus: ExecutionStatus.scheduled,
      taskInfo,
      taskResult: {
        executionStatus: ExecutionStatus.scheduled,
      },
    })

    if (!this.isQueueActive) {
      sendAbortEvent(`task-queue was closed. aborting quay-build`)
      return
    }
    if (this.isTaskTimeout({ taskTimeoutMs, startTaskMs })) {
      sendAbortEvent(`task-timeout`)
      return
    }
    this.eventEmitter.emit(ExecutionStatus.running, {
      taskExecutionStatus: ExecutionStatus.running,
      taskInfo,
      taskResult: {
        executionStatus: ExecutionStatus.running,
      },
    })
    const { repoName, visibility } = this.options.taskQueueConfigurations.getQuayRepoInfo(packageName)

    let buildTriggerResult: BuildTriggerResult | undefined
    try {
      await this.quayClient.createRepo({
        taskId: taskInfo.taskId,
        repoName,
        visibility,
        packageName,
      })
      if (!this.isQueueActive) {
        sendAbortEvent(`task-queue was closed. aborting quay-build`)
        return
      }
      if (this.isTaskTimeout({ taskTimeoutMs, startTaskMs })) {
        sendAbortEvent(`task-timeout`)
        return
      }
      await Promise.all(
        Object.values(QuayNotificationEvents).map(event =>
          this.quayClient.createNotification({
            taskId: taskInfo.taskId,
            event,
            packageName,
            repoName,
            webhookUrl: `${this.options.taskQueueConfigurations.quayServiceHelperAddress}/quay-build-notification/${event}`,
          }),
        ),
      )
      if (!this.isQueueActive) {
        sendAbortEvent(`task-queue was closed. aborting quay-build`)
        return
      }
      if (this.isTaskTimeout({ taskTimeoutMs, startTaskMs })) {
        sendAbortEvent(`task-timeout`)
        return
      }
      buildTriggerResult = await this.quayClient.triggerBuild({
        taskId: taskInfo.taskId,
        packageName,
        imageTags,
        relativeContextPath,
        relativeDockerfilePath,
        gitRepoName: this.options.gitRepoInfo.repoName,
        quayRepoName: repoName,
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
      this.tasks.set(taskInfo.taskId, {
        taskTimeoutMs,
        lastEmittedTaskExecutionStatus: ExecutionStatus.running,
        startTaskMs,
        taskInfo,
        lastKnownQuayBuildStatus: buildTriggerResult.quayBuildStatus,
        packageName,
        ...buildTriggerResult,
      })
    } catch (error: unknown) {
      if (buildTriggerResult) {
        await this.quayClient
          .cancelBuild({ taskId: taskInfo.taskId, packageName, quayBuildId: buildTriggerResult.quayBuildId })
          .catch(() => {
            // the build maybe was not triggered
          })
      }
      if (error instanceof CancelError && !this.isQueueActive) {
        sendAbortEvent(`task-queue was closed. aborting quay-build`)
        return
      }
      if (error instanceof CancelError && this.isTaskTimeout({ taskId: taskInfo.taskId })) {
        sendAbortEvent(`task-timeout`)
        return
      }
      this.eventEmitter.emit(ExecutionStatus.aborted, {
        taskExecutionStatus: ExecutionStatus.aborted,
        taskInfo,
        taskResult: {
          executionStatus: ExecutionStatus.aborted,
          durationMs: Date.now() - startTaskMs,
          errors: [serializeError(error)],
          notes: [],
          status: Status.skippedAsFailed,
        },
      })
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

    scheduledAndRunningTasks.forEach(b =>
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
      }),
    )

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
