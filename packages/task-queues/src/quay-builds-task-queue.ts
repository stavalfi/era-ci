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
import got, { CancelError } from 'got'
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
import _ from 'lodash'
import urlJoin from 'url-join'

export type QuayBuildsTaskPayload = Record<string, never>

export { QuayBuildStatus, QuayNotificationEvents } from '@era-ci/quay-client'

export type QuayBuildsTaskQueueConfigurations = {
  redis: {
    url: string
    auth?: {
      username?: string
      password?: string
    }
  }
  quayHelperServiceUrl: string
  quayAddress: 'https://quay.io' | string
  quayToken: string
  quayNamespace: string
  getCommitTarGzPublicAddress: (options: {
    repoNameWithOrgName: string
    gitCommit: string
  }) => Promise<{
    url: string
    folderName: string
  }>
}

// if you change this strin, change it also in "quay-helper-service" because it depends on it.
// "quay-helper-service" don't import this package to avoid big docker-image
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
  taskInfo: TaskInfo<QuayBuildsTaskPayload>
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

export class QuayBuildsTaskQueue implements TaskQueueBase<QuayBuildsTaskQueueConfigurations, QuayBuildsTaskPayload> {
  public readonly eventEmitter: TaskQueueEventEmitter<QuayBuildsTaskPayload> = new EventEmitter({
    captureRejections: true,
  })
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
    this.taskTimeoutEventEmitter.setMaxListeners(Infinity)
    this.queueStatusChanged.setMaxListeners(Infinity)
    this.quayClient = new QuayClient(
      options.taskQueueConfigurations.quayAddress,
      options.taskQueueConfigurations.quayToken,
      options.taskQueueConfigurations.quayNamespace,
      options.log,
      options.processEnv,
      this.taskTimeoutEventEmitter,
      this.queueStatusChanged,
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
            repoName: task.quayRepoName,
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

    options.log.trace(
      `initialized ${QuayBuildsTaskQueue.name} with options: ${JSON.stringify(
        _.omit(options, ['redisClient']),
        null,
        2,
      )}`,
    )
  }

  private isTaskTimeout = (
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
  ): boolean => {
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

  private onQuayBuildStatusChanged = async (topic: string, eventString: string, retry = 0): Promise<void> => {
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
    const task = Array.from(this.tasks.values()).find(b => b.quayBuildId === event.quayBuildId)!
    if (!task) {
      if (retry >= 30) {
        this.options.log.trace(`can't find build-id: "${event.quayBuildId}" which we received from quay-helper-service`)
      }
      // quay sent us a quay-build-id: "${event.quayBuildId}" which we don't know.
      // it can be from one of two reasons:
      // 1. there is other quay-build running right now and we got his event as well (every redis event is sent to all subscribers).
      // 2. quay gave us build-id in the REST-POST /build but we didn't process it yet and
      // then quay sent us notification about this build-id. let's process this event again with a delay of 1 second.
      await new Promise(res => setTimeout(res, 1000))
      return this.onQuayBuildStatusChanged(topic, eventString)
    }

    this.options.log.debug(`new event on topic: "${topic}" from quay-server: ${JSON.stringify(event, null, 2)}`)

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

  public addTasksToQueue = (
    tasksOptions: {
      packageName: string
      repoName: string
      visibility: 'public' | 'private'
      relativeContextPath: string
      relativeDockerfilePath: string
      imageTags: string[]
      taskTimeoutMs: number
    }[],
  ): TaskInfo<QuayBuildsTaskPayload>[] => {
    const startTaskMs = Date.now()
    if (!this.isQueueActive) {
      throw new Error(`task-queue was destroyed so you can not add new tasks to it`)
    }

    const tasks: TaskInfo<QuayBuildsTaskPayload>[] = []

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

      const taskInfo: TaskInfo<QuayBuildsTaskPayload> = {
        taskName: `${taskOptions.packageName}-docker-image`,
        // for now, we support triggering a build on the same image+tag multiple
        // times because maybe the caller may have retry algorithm so the taskId must be random.
        // later on, we may stop supporting it and the taskId will be deterministic to make sure
        // that we don't trigger the same build multiple times. and the task-ids will be saved in redis(?).
        taskId: chance().hash().slice(0, 8),
        payload: {},
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

  public getBuildLogsAddress = (taskId: string): string | undefined => {
    const task = this.tasks.get(taskId)
    if (!task) {
      throw new Error(`taskId: ${taskId} not found`)
    }
    return task.quayBuildLogsAddress
  }

  private buildImage = async (task: Task): Promise<void> => {
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
      const { url, folderName } = await this.options.taskQueueConfigurations.getCommitTarGzPublicAddress({
        repoNameWithOrgName: this.options.gitRepoInfo.repoNameWithOrgName,
        gitCommit: this.options.gitRepoInfo.commit,
      })

      const isUrlExist = await got.head(url).then(
        () => true,
        () => false,
      )
      if (!isUrlExist) {
        sendAbortEvent({
          notes: [
            `the generated url from your configuration (getCommitTarGzPublicAddress) is not reachable: "${url}". Did you forgot to push your commit?`,
          ],
          errors: [],
        })
        return
      }

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

      const existingNotifications = await this.quayClient.getNotifications({
        repoName: task.quayRepoName,
        taskId: task.taskInfo.taskId,
        org: this.options.taskQueueConfigurations.quayNamespace,
      })

      const createWebhookUrl = (event: QuayNotificationEvents) =>
        `${this.options.taskQueueConfigurations.quayHelperServiceUrl}/quay-build-notification/${event}`
      await Promise.all(
        Object.values(QuayNotificationEvents)
          // dont create the same notification again
          .filter(
            notificationType =>
              !existingNotifications.notifications.some(
                n =>
                  n.event === notificationType && n.method === 'webhook' && n.config.url === createWebhookUrl(n.event),
              ),
          )
          .map(event =>
            this.quayClient.createNotification({
              taskId: task.taskInfo.taskId,
              event,
              org: this.options.taskQueueConfigurations.quayNamespace,
              packageName: task.packageName,
              repoName: task.quayRepoName,
              webhookUrl: createWebhookUrl(event),
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

      const relativeContextPath = path.join(folderName, task.relativeContextPath)
      const relativeDockerfilePath = path.join(folderName, task.relativeDockerfilePath)

      buildTriggerResult = await this.quayClient.triggerBuild({
        taskId: task.taskInfo.taskId,
        packageName: task.packageName,
        imageTags: task.imageTags,
        relativeContextPath,
        relativeDockerfilePath,
        quayRepoName: task.quayRepoName,
        archiveUrl: url,
      })

      this.options.log.verbose(`starting quay build for:`, {
        taskId: task.taskInfo.taskId,
        packageName: task.packageName,
        quayBuildId: buildTriggerResult.quayBuildId,
      })

      this.tasks.set(task.taskInfo.taskId, {
        ...this.tasks.get(task.taskInfo.taskId),
        ...task,
        ...buildTriggerResult,
        lastEmittedTaskExecutionStatus: ExecutionStatus.running,
        lastKnownQuayBuildStatus: buildTriggerResult.quayBuildStatus,
      })

      // it looks like quay has a bug and they don't report failure-status in webhook.
      // so we do pulling on the status and sent it to us as redis-event
      await got.post(
        urlJoin(this.options.taskQueueConfigurations.quayHelperServiceUrl, 'quay-build-notification-pulling'),
        {
          json: {
            build_id: buildTriggerResult.quayBuildId,
            quayAddress: this.options.taskQueueConfigurations.quayAddress,
            quayToken: this.options.taskQueueConfigurations.quayToken,
            quayNamespace: this.options.taskQueueConfigurations.quayNamespace,
            eraTaskId: task.taskInfo.taskId,
            quayRepoName: task.quayRepoName,
          },
        },
      )
    } catch (error: unknown) {
      if (buildTriggerResult) {
        await this.quayClient
          .cancelBuild({
            repoName: task.quayRepoName,
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

  public cleanup = async (): Promise<void> => {
    if (!this.isQueueActive) {
      return
    }
    this.isQueueActive = false

    this.options.log.debug(`closing quay-builds task-queue and aborting scheduled and running tasks`)
    await Promise.all(this.cleanups.map(f => f()))
    // ensure we don't send events of any processing or pending tasks
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

    this.options.log.debug(`closed quay-builds task-queue and aborted scheduled and running tasks`)
  }
}

export const quayBuildsTaskQueue = createTaskQueue<
  QuayBuildsTaskQueue,
  QuayBuildsTaskPayload,
  QuayBuildsTaskQueueConfigurations
>({
  taskQueueName: 'quay-builds-task-queue',
  initializeTaskQueue: async options => {
    const redisConnection = new Redis(options.taskQueueConfigurations.redis.url, {
      lazyConnect: true,
      username: options.taskQueueConfigurations.redis.auth?.username,
      password: options.taskQueueConfigurations.redis.auth?.password,
    })
    await redisConnection.connect()
    await redisConnection.subscribe(
      options.processEnv.QUAY_BUILD_STATUS_CHANED_TEST_REDIS_TOPIC || QUAY_BUILD_STATUS_CHANED_REDIS_TOPIC,
    )
    return new QuayBuildsTaskQueue(options, redisConnection)
  },
})
