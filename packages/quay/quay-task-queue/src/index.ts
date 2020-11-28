import {
  createTaskQueue,
  ExecutionStatus,
  Status,
  TaskInfo,
  TaskQueueBase,
  TaskQueueEventEmitter,
  TaskQueueOptions,
} from '@tahini/nc'
import { queue } from 'async'
import chance from 'chance'
import { EventEmitter } from 'events'
import got, { CancelError, TimeoutError } from 'got'
import Request from 'got/dist/source/core'
import Redis from 'ioredis'
import { BuildTriggerResult, QuayBuildStatus, QuayClient, QuayNotificationEvents } from './quay-client'
import { AbortEventHandler } from './types'
import { serializeError } from 'serialize-error'

export { QuayBuildStatus, QuayNotificationEvents } from './quay-client'

export type QuayBuildsTaskQueueConfigurations = {
  redisAddress: string
  quayAddress: 'https://quay.io' | string
  quayServiceHelperAddress: string
  quayToken: string
  quayNamespace: string
  taskTimeoutMs: number
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
  private readonly builds: Map<
    string,
    {
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
  private readonly internalTaskQueue = queue<() => Promise<unknown>>(async (task, done) => {
    try {
      await task()
      done()
    } catch (error) {
      done(error)
    }
  }, 1)

  constructor(
    private readonly options: TaskQueueOptions<QuayBuildsTaskQueueConfigurations>,
    private readonly redisConnection: Redis.Redis,
  ) {
    this.quayClient = new QuayClient(
      this.queueStatusChanged,
      options.taskQueueConfigurations.quayAddress,
      options.taskQueueConfigurations.quayToken,
      options.taskQueueConfigurations.quayNamespace,
      options.log,
    )
    this.redisConnection.on('message', this.onQuayBuildStatusChanged.bind(this))
    options.log.verbose(`initialized ${QuayBuildsTaskQueue.name}`)
  }

  private onQuayBuildStatusChanged(topic: string, eventString: string) {
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
    const build = Array.from(this.builds.values()).find(b => b.quayBuildId === event.quayBuildId)
    if (!build) {
      this.options.log.error(
        `quay sent us a quay-build-id: "${event.quayBuildId}" which we don't know. looks like a bug. ignoring it...`,
      )
      return
    }
    build.lastKnownQuayBuildStatus = event.quayBuildStatus

    if (event.quayBuildStatus === 'complete') {
      this.eventEmitter.emit(ExecutionStatus.done, {
        taskExecutionStatus: ExecutionStatus.done,
        taskInfo: build.taskInfo,
        taskResult: {
          executionStatus: ExecutionStatus.done,
          durationMs: Date.now() - build.startTaskMs,
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
        taskInfo: build.taskInfo,
        taskResult: {
          executionStatus: ExecutionStatus.done,
          durationMs: Date.now() - build.startTaskMs,
          errors: [],
          notes: [`build-logs: "${build.quayBuildLogsAddress}"`],
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
    }[],
  ): void {
    const startTaskMs = Date.now()
    if (!this.isQueueActive) {
      throw new Error(`task-queue was destroyed so you can not add new tasks to it`)
    }

    this.internalTaskQueue.push(() => Promise.all(tasksOptions.map(t => this.buildImage({ ...t, startTaskMs }))))
  }

  public getBuildLogs(taskId: string): Request {
    const build = this.builds.get(taskId)
    if (!build) {
      throw new Error(`taskId: ${taskId} not found`)
    }
    return got.stream(build.quayBuildLogsAddress, {
      headers: {
        Authorization: `Bearer ${this.options.taskQueueConfigurations.quayToken}`,
      },
    })
  }

  private async buildImage({
    startTaskMs,
    packageName,
    imageTags,
    relativeContextPath,
    relativeDockerfilePath,
  }: {
    startTaskMs: number
    packageName: string
    relativeContextPath: string
    relativeDockerfilePath: string
    imageTags: string[]
  }): Promise<void> {
    const taskInfo: TaskInfo = {
      taskName: `${packageName}-docker-image`,
      // for now, we support triggering a build on the same image+tag multiple
      // times because maybe the caller may have retry algorithm so the taskId must be random.
      // later on, we may stop supporting it and the taskId will be deterministic to make sure
      // that we don't trigger the same build multiple times. and the task-ids will be saved in redis(?).
      taskId: chance().hash(),
    }

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
        repoName,
        visibility,
        packageName,
        timeoutMs: this.options.taskQueueConfigurations.taskTimeoutMs - (Date.now() - startTaskMs),
      })
      if (!this.isQueueActive) {
        sendAbortEvent(`task-queue was closed. aborting quay-build`)
        return
      }
      await Promise.all(
        Object.values(QuayNotificationEvents).map(event =>
          this.quayClient.createNotification({
            event,
            packageName,
            repoName,
            webhookUrl: `${this.options.taskQueueConfigurations.quayServiceHelperAddress}/quay-build-notification/${event}`,
            timeoutMs: this.options.taskQueueConfigurations.taskTimeoutMs - (Date.now() - startTaskMs),
          }),
        ),
      )
      if (!this.isQueueActive) {
        sendAbortEvent(`task-queue was closed. aborting quay-build`)
        return
      }
      buildTriggerResult = await this.quayClient.triggerBuild({
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
        timeoutMs: this.options.taskQueueConfigurations.taskTimeoutMs - (Date.now() - startTaskMs),
      })
      this.builds.set(taskInfo.taskId, {
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
          .cancelBuild({ packageName, quayBuildId: buildTriggerResult.quayBuildId, timeoutMs: 5_000 })
          .catch(() => {
            // the build maybe was not triggered
          })
      }
      if (error instanceof CancelError) {
        sendAbortEvent(`task-queue was closed. aborting quay-build`)
        return
      }
      if (error instanceof TimeoutError) {
        sendAbortEvent(`task-timeout. aboring quay-build`)
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
    // ensure we don't send events of any processing or pending tasks
    this.isQueueActive = false
    this.queueStatusChanged.emit('closed')
    if (!this.internalTaskQueue.idle()) {
      // drain will not resolve if the queue is empty so we drain if it's not empty
      await this.internalTaskQueue.drain()
    }
    this.internalTaskQueue.kill()

    const scheduledAndRunningTasks = Array.from(this.builds.values()).filter(
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
