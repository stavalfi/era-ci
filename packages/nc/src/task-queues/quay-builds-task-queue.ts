import chance from 'chance'
import { EventEmitter } from 'events'
import got, { CancelError } from 'got'
import Request from 'got/dist/source/core'
import _ from 'lodash'
import path from 'path'
import { TaskInfo } from '../create-task-queue'
import { createTaskQueue, TaskQueueBase, TaskQueueEventEmitter, TaskQueueOptions } from '../create-task-queue'
import { ExecutionStatus, Status } from '../types'
import { buildFullDockerImageName } from '../utils'
import { StrictEventEmitter } from 'strict-event-emitter-types'

export type QuayBuildsTaskQueueConfigurations = {
  quayAddress: 'https://quay.io' | string
  quayToken: string
  quayNamespace: string
  quayBuildStatusPullIntervalMs: number
  taskTimeoutMs: number
  getQuayRepoInfo: (packageName: string) => { repoName: string; visibility: 'public' | 'private' }
  getCommitTarGzPublicAddress: (options: {
    repoNameWithOrgName: string
    gitCommit: string
    gitAuth: {
      username: string
      token: string
    }
  }) => string
}

type QuayCreateRepoResult = { kind: 'image'; namespace: string; name: string }

type QuayNewBuildResult = {
  status: unknown // {}
  error: null
  display_name: 'be2b182'
  repository: { namespace: string; name: string }
  subdirectory: string
  started: string
  tags: string[]
  archive_url: string
  pull_robot: null
  trigger: null
  trigger_metadata: unknown // {}
  context: string
  is_writer: true
  phase: 'waiting' | 'complete' | 'error'
  resource_key: null
  manual_user: string
  id: '5a513d5d-9d01-49a8-8325-2a3bd4c446e3'
  dockerfile_path: string
}

export class QuayBuildsTaskQueue implements TaskQueueBase<QuayBuildsTaskQueueConfigurations> {
  public readonly eventEmitter: TaskQueueEventEmitter = new EventEmitter({ captureRejections: true })
  private readonly builds: Map<
    string,
    {
      startTaskMs: number
      taskInfo: TaskInfo
      packageName: string
      fullDockerImageNames: string[]
      quayRepoName: string
      quayBuildName: string
      quayBuildId: string
      quayBuildAddress: string
      quayBuildLogsAddress: string
      lastKnownQuayBuildStatus: string
    }
  > = new Map()
  private isQueueActive = true
  private queueStatusChanged: StrictEventEmitter<
    EventEmitter,
    {
      closed: () => void
    }
  > = new EventEmitter({
    captureRejections: true,
  })

  constructor(private readonly options: TaskQueueOptions<QuayBuildsTaskQueueConfigurations>) {
    this.options.log.verbose(`initialized ${QuayBuildsTaskQueue.name}`)
  }

  private async createRepo({
    packageName,
    repoName,
    visibility,
    startTaskMs,
  }: {
    packageName: string
    repoName: string
    visibility: 'public' | 'private'
    startTaskMs: number
  }): Promise<void> {
    try {
      if (!this.isQueueActive) {
        throw new Error(`task-queue is closed`)
      }
      const p = got.post<QuayCreateRepoResult>(
        `${this.options.taskQueueConfigurations.quayAddress}/api/v1/repository`,
        {
          headers: {
            Authorization: `Bearer ${this.options.taskQueueConfigurations.quayToken}`,
          },
          json: {
            repo_kind: 'image',
            namespace: this.options.taskQueueConfigurations.quayNamespace,
            visibility,
            repository: repoName,
            description: `image repository to package: ${packageName}`,
          },
          responseType: 'json',
          resolveBodyOnly: true,
          timeout: this.options.taskQueueConfigurations.taskTimeoutMs - (Date.now() - startTaskMs),
        },
      )
      this.queueStatusChanged.once('closed', () => p.cancel())
      const quayRepoCreation = await p
      this.options.log.info(
        `created image-repository: "${this.options.taskQueueConfigurations.quayAddress}/repository/${quayRepoCreation.namespace}/${quayRepoCreation.name}" for package: "${packageName}" with visibility: "${visibility}"`,
      )
    } catch (error) {
      if (error.response.body.error_message === 'Repository already exists') {
        return Promise.resolve()
      } else {
        throw error
      }
    }
  }

  private async getBuildStatus({
    startTaskMs,
    taskId,
  }: {
    taskId: string
    startTaskMs: number
  }): Promise<QuayNewBuildResult['phase']> {
    const build = this.builds.get(taskId)
    if (!build) {
      throw new Error(`taskId: ${taskId} not found`)
    }
    const p = got.get<QuayNewBuildResult>(
      `${this.options.taskQueueConfigurations.quayAddress}/api/v1/repository/build/${build.quayBuildId}/status`,
      {
        headers: {
          Authorization: `Bearer ${this.options.taskQueueConfigurations.quayToken}`,
        },
        responseType: 'json',
        resolveBodyOnly: true,
        timeout: this.options.taskQueueConfigurations.taskTimeoutMs - (Date.now() - startTaskMs),
      },
    )
    this.queueStatusChanged.once('closed', () => p.cancel())
    const quayBuildStatus = await p
    build.lastKnownQuayBuildStatus = quayBuildStatus.phase
    return quayBuildStatus.phase
  }

  private async cancelBuild({ timeoutMs, taskId }: { taskId: string; timeoutMs: number }): Promise<void> {
    const build = this.builds.get(taskId)
    if (!build) {
      throw new Error(`taskId: ${taskId} not found`)
    }
    await got.delete<QuayNewBuildResult>(
      `${this.options.taskQueueConfigurations.quayAddress}/api/v1/repository/build/${build.quayBuildId}`,
      {
        headers: {
          Authorization: `Bearer ${this.options.taskQueueConfigurations.quayToken}`,
        },
        responseType: 'json',
        resolveBodyOnly: true,
        timeout: timeoutMs,
      },
    )
    this.options.log.info(
      `canceled image-build for package: "${build.packageName}": "${
        build.quayBuildAddress
      }" for images: [${build.fullDockerImageNames.join(',')}]`,
    )
  }

  private async triggerBuild({
    startTaskMs,
    repoName,
    relativeContextPath,
    relativeDockerfilePath,
    imageTags,
    packageName,
  }: {
    repoName: string
    packageName: string
    relativeContextPath: string
    relativeDockerfilePath: string
    imageTags: string[]
    startTaskMs: number
  }): Promise<{
    quayRepoName: string
    quayBuildId: string
    quayBuildName: string
    quayBuildAddress: string
    quayBuildLogsAddress: string
    quayBuildStatus: QuayNewBuildResult['phase']
  }> {
    if (!this.isQueueActive) {
      throw new Error(`task-queue is closed`)
    }
    const p = got.post<QuayNewBuildResult>(
      `${this.options.taskQueueConfigurations.quayAddress}/api/v1/repository/${this.options.taskQueueConfigurations.quayNamespace}/${repoName}/build/`,
      {
        headers: {
          Authorization: `Bearer ${this.options.taskQueueConfigurations.quayToken}`,
        },
        json: {
          archive_url: this.options.taskQueueConfigurations.getCommitTarGzPublicAddress({
            repoNameWithOrgName: this.options.gitRepoInfo.repoNameWithOrgName,
            gitCommit: this.options.gitRepoInfo.commit,
            gitAuth: {
              username: this.options.gitRepoInfo.auth.username,
              token: this.options.gitRepoInfo.auth.username,
            },
          }),
          docker_tags: imageTags,
          context: path.join(
            `/${this.options.gitRepoInfo.repoName}-${this.options.gitRepoInfo.commit}`,
            relativeContextPath,
          ),
          dockerfile_path: path.join(
            `/${this.options.gitRepoInfo.repoName}-${this.options.gitRepoInfo.commit}`,
            relativeDockerfilePath,
          ),
        },
        responseType: 'json',
        resolveBodyOnly: true,
        timeout: this.options.taskQueueConfigurations.taskTimeoutMs - (Date.now() - startTaskMs),
      },
    )
    this.queueStatusChanged.once('closed', () => p.cancel())
    const buildInfo = await p
    const result = {
      quayRepoName: buildInfo.repository.name,
      quayBuildId: buildInfo.id,
      quayBuildName: buildInfo.display_name,
      quayBuildAddress: `${this.options.taskQueueConfigurations.quayAddress}/repository/${buildInfo.repository.namespace}/${buildInfo.repository.name}/build/${buildInfo.id}`,
      quayBuildLogsAddress: `${this.options.taskQueueConfigurations.quayAddress}/buildlogs/${buildInfo.id}`,
      quayBuildStatus: buildInfo.phase,
    }
    this.options.log.info(
      `start image-build for package: "${packageName}": "${
        result.quayBuildAddress
      }" for images: [${this.getFullImageNames({
        dockerRegistry: this.options.taskQueueConfigurations.quayAddress,
        imageName: buildInfo.repository.name,
        imageNamespace: buildInfo.repository.namespace,
        imageTags,
      }).join(',')}]`,
    )
    return result
  }

  private getFullImageNames({
    dockerRegistry,
    imageName,
    imageNamespace,
    imageTags,
  }: {
    dockerRegistry: string
    imageNamespace: string
    imageName: string
    imageTags: string[]
  }): string[] {
    return imageTags.map(imageTag =>
      buildFullDockerImageName({
        dockerOrganizationName: imageNamespace,
        dockerRegistry,
        imageName,
        imageTag,
      }),
    )
  }

  public async addTasksToQueue(
    tasksOptions: {
      packageName: string
      relativeContextPath: string
      relativeDockerfilePath: string
      imageTags: string[]
    }[],
  ): Promise<void> {
    const startTaskMs = Date.now()
    if (!this.isQueueActive) {
      throw new Error(`task-queue was destroyed so you can not add new tasks to it`)
    }

    await Promise.all(
      tasksOptions.map(async t => {
        const taskInfo: TaskInfo = {
          taskName: `${t.packageName}-docker-image`,
          // for now, we support triggering a build on the same image+tag multiple
          // times because maybe the caller may have retry algorithm so the taskId must be random.
          // later on, we may stop supporting it and the taskId will be deterministic to make sure
          // that we don't trigger the same build multiple times. and the task-ids will be saved in redis(?).
          taskId: chance().hash(),
        }
        this.eventEmitter.emit(ExecutionStatus.scheduled, {
          taskExecutionStatus: ExecutionStatus.scheduled,
          taskInfo,
          taskResult: {
            executionStatus: ExecutionStatus.scheduled,
          },
        })
        await this.buildImage({ ...t, taskInfo, startTaskMs })
      }),
    )
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
    taskInfo,
    packageName,
    imageTags,
    relativeContextPath,
    relativeDockerfilePath,
  }: {
    startTaskMs: number
    taskInfo: TaskInfo
    packageName: string
    relativeContextPath: string
    relativeDockerfilePath: string
    imageTags: string[]
  }): Promise<void> {
    if (!this.isQueueActive) {
      throw new Error(`task-queue is closed`)
    }
    this.eventEmitter.emit(ExecutionStatus.running, {
      taskExecutionStatus: ExecutionStatus.running,
      taskInfo,
      taskResult: {
        executionStatus: ExecutionStatus.running,
      },
    })
    const { repoName, visibility } = this.options.taskQueueConfigurations.getQuayRepoInfo(packageName)

    try {
      await this.createRepo({ repoName, visibility, packageName: packageName, startTaskMs })
      const buildTriggerResult = await this.triggerBuild({
        packageName,
        imageTags,
        relativeContextPath,
        relativeDockerfilePath,
        repoName,
        startTaskMs,
      })
      this.builds.set(taskInfo.taskId, {
        startTaskMs,
        taskInfo,
        fullDockerImageNames: this.getFullImageNames({
          dockerRegistry: this.options.taskQueueConfigurations.quayAddress,
          imageName: repoName,
          imageNamespace: this.options.taskQueueConfigurations.quayNamespace,
          imageTags: imageTags,
        }),
        lastKnownQuayBuildStatus: buildTriggerResult.quayBuildStatus,
        packageName,
        ...buildTriggerResult,
      })
    } catch (error: unknown) {
      if (!(error instanceof CancelError)) {
        throw error
      }
    }

    const getSleepMs = (sleepMs: number) => {
      if (!this.isQueueActive) {
        return 0
      }
      const timeLeftMs = this.options.taskQueueConfigurations.taskTimeoutMs - (Date.now() - startTaskMs)
      return Math.min(timeLeftMs, sleepMs)
    }

    while (this.isQueueActive && this.options.taskQueueConfigurations.taskTimeoutMs - (Date.now() - startTaskMs)) {
      const currentQuayBuildStatus = await this.getBuildStatus({ startTaskMs, taskId: taskInfo.taskId })

      if (currentQuayBuildStatus === 'complete') {
        this.eventEmitter.emit(ExecutionStatus.done, {
          taskExecutionStatus: ExecutionStatus.done,
          taskInfo,
          taskResult: {
            executionStatus: ExecutionStatus.done,
            durationMs: Date.now() - startTaskMs,
            errors: [],
            notes: [],
            status: Status.passed,
          },
        })
        return
      }
      if (currentQuayBuildStatus === 'error') {
        this.eventEmitter.emit(ExecutionStatus.done, {
          taskExecutionStatus: ExecutionStatus.done,
          taskInfo,
          taskResult: {
            executionStatus: ExecutionStatus.done,
            durationMs: Date.now() - startTaskMs,
            errors: [],
            notes: [`build-logs: "${buildTriggerResult.quayBuildLogsAddress}"`],
            status: Status.failed,
          },
        })
        return
      }

      await new Promise(res =>
        setTimeout(res, getSleepMs(this.options.taskQueueConfigurations.quayBuildStatusPullIntervalMs)),
      )
    }

    await this.cancelBuild({ taskId: taskInfo.taskId, timeoutMs: 5_000 }).catch(() => {
      // the build maybe was not triggered
    })

    this.eventEmitter.emit(ExecutionStatus.aborted, {
      taskExecutionStatus: ExecutionStatus.aborted,
      taskInfo,
      taskResult: {
        executionStatus: ExecutionStatus.aborted,
        durationMs: Date.now() - startTaskMs,
        errors: [],
        notes: [`quay-build-timeout reached: quay-build canceled.`],
        status: Status.skippedAsFailed,
      },
    })
  }

  public async cleanup(): Promise<void> {
    if (!this.isQueueActive) {
      return
    }

    this.options.log.verbose(`closing quay-builds task-queue and aborting scheduled and running tasks`)
    // ensure we don't send events of any processing or pending tasks
    this.isQueueActive = false
    this.queueStatusChanged.emit('closed')

    for (const build of this.builds.values()) {
      const buildCanceled = await this.cancelBuild({ taskId: build.taskInfo.taskId, timeoutMs: 5_000 }).then(
        () => true,
        () => false,
      )
      this.eventEmitter.emit(ExecutionStatus.aborted, {
        taskExecutionStatus: ExecutionStatus.aborted,
        taskInfo: build.taskInfo,
        taskResult: {
          executionStatus: ExecutionStatus.aborted,
          durationMs: Date.now() - build.startTaskMs,
          errors: [],
          notes: [
            `quay-build-timeout reached: ${buildCanceled ? 'quay-build canceled' : 'quay-build was not triggered'}`,
          ],
          status: Status.skippedAsFailed,
        },
      })
    }

    this.options.log.verbose(`closed quay-builds task-queue and aborted scheduled and running tasks`)
  }
}

export const quayBuildsTaskQueue = createTaskQueue<QuayBuildsTaskQueue, QuayBuildsTaskQueueConfigurations>({
  taskQueueName: 'quay-builds-task-queue',
  initializeTaskQueue: async options => new QuayBuildsTaskQueue(options),
})
