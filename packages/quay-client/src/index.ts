import { Log, TaskTimeoutEventEmitter } from '@tahini/core'
import { buildFullDockerImageName } from '@tahini/utils'
import got, { RequestError } from 'got'
import HttpStatusCodes from 'http-status-codes'
import path from 'path'
import { AbortEventHandler } from './types'

export { AbortEventHandler } from './types'

export enum QuayBuildStatus {
  waiting = 'waiting',
  started = 'started', // this is not confirmed. can't find in the docs what it is
  cancelled = 'cancelled', // this is not confirmed. can't find in the docs if this exists
  complete = 'complete',
  error = 'error',
}

export type QuayCreateRepoResult = { kind: 'image'; namespace: string; name: string }

export type QuayNewBuildResult = {
  status: unknown // {}
  error: null
  display_name: string
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
  phase: QuayBuildStatus
  resource_key: null
  manual_user: string
  id: string
  dockerfile_path: string
}

export type BuildTriggerResult = {
  quayRepoName: string
  quayBuildId: string
  quayBuildName: string
  quayBuildAddress: string
  quayBuildLogsAddress: string
  quayBuildStatus: QuayBuildStatus
}

export enum QuayNotificationEvents {
  buildQueued = 'build_queued',
  buildStart = 'build_start',
  buildSuccess = 'build_success',
  buildFailure = 'build_failure',
  buildCancelled = 'build_cancelled',
}

export type CreateNotificationResult = {
  event_config: Record<string, unknown>
  uuid: string
  title: string
  number_of_failures: number
  method: 'webhook'
  config: {
    url: string
    template: string // it's JSON.strigify of request.body.config.template
  }
  event: QuayNotificationEvents
}

export class QuayClient {
  constructor(
    private readonly taskTimeoutEventEmitter: TaskTimeoutEventEmitter,
    private readonly abortEventHandler: AbortEventHandler,
    private readonly quayAddress: string,
    private readonly quayToken: string,
    private readonly quayNamespace: string,
    private readonly log: Log,
  ) {}

  private async request<ResponseBody, RequestBody = unknown>(options: {
    method: 'get' | 'post' | 'delete'
    api: string
    requestBody?: RequestBody
    taskId: string
  }): Promise<ResponseBody> {
    const p = got[options.method]<ResponseBody>(`${this.quayAddress}/${options.api}`, {
      headers: {
        authorization: `Bearer ${this.quayToken}`,
      },
      json: options.requestBody,
      responseType: 'json',
      resolveBodyOnly: true,
      retry: {
        calculateDelay: ({ error }) => {
          if (error instanceof RequestError && error.response?.statusCode === HttpStatusCodes.TOO_MANY_REQUESTS) {
            const wait = error.response?.headers['retry-after']
            return wait === undefined ? 1000 : Number(wait)
          }
          return 0 // cancel the retry mechanism
        },
      },
    })

    this.abortEventHandler.once('closed', () => p.cancel())
    this.taskTimeoutEventEmitter.once('timeout', taskId => {
      if (taskId === options.taskId) {
        p.cancel()
      }
    })

    return p
  }

  public async createRepo({
    packageName,
    taskId,
    repoName,
    visibility,
  }: {
    taskId: string
    packageName: string
    repoName: string
    visibility: 'public' | 'private'
  }): Promise<QuayCreateRepoResult> {
    try {
      const r = await this.request<QuayCreateRepoResult>({
        taskId,
        method: 'post',
        api: `api/v1/repository`,
        requestBody: {
          repo_kind: 'image',
          namespace: this.quayNamespace,
          visibility,
          repository: repoName,
          description: `image repository to package: ${packageName}`,
        },
      })
      this.log.info(
        `created quay-repository: "${this.quayAddress}/repository/${r.namespace}/${r.name}" for package: "${packageName}" with visibility: "${visibility}"`,
      )
      return r
    } catch (error) {
      if (error?.response?.body?.error_message === 'Repository already exists') {
        return {
          kind: 'image',
          namespace: this.quayNamespace,
          name: repoName,
        }
      } else {
        throw error
      }
    }
  }

  public async getBuildStatus({
    quayBuildId,
    taskId,
  }: {
    quayBuildId: string
    taskId: string
  }): Promise<QuayNewBuildResult['phase']> {
    const quayBuildStatus = await this.request<QuayNewBuildResult>({
      taskId,
      method: 'get',
      api: `api/v1/repository/build/${quayBuildId}/status`,
    })

    return quayBuildStatus.phase
  }

  public async cancelBuild({
    quayBuildId,
    packageName,
    taskId,
  }: {
    quayBuildId: string
    packageName: string
    taskId: string
  }): Promise<void> {
    await this.request({
      taskId,
      method: 'delete',
      api: `api/v1/repository/build/${quayBuildId}`,
    })

    this.log.info(`canceled image-build for package: "${packageName}" in quay`)
  }

  public async triggerBuild({
    gitRepoName,
    quayRepoName,
    relativeContextPath,
    relativeDockerfilePath,
    imageTags,
    packageName,
    archiveUrl,
    commit,
    taskId,
  }: {
    gitRepoName: string
    quayRepoName: string
    commit: string
    packageName: string
    relativeContextPath: string
    relativeDockerfilePath: string
    imageTags: string[]
    archiveUrl: string
    taskId: string
  }): Promise<BuildTriggerResult> {
    const buildInfo = await this.request<QuayNewBuildResult>({
      taskId,
      method: 'post',
      api: `api/v1/repository/${this.quayNamespace}/${quayRepoName}/build/`,
      requestBody: {
        archive_url: archiveUrl,
        docker_tags: imageTags,
        context: path.join(`${gitRepoName}-${commit}`, relativeContextPath),
        dockerfile_path: path.join(`${gitRepoName}-${commit}`, relativeDockerfilePath),
      },
    })

    const result = {
      quayRepoName: buildInfo.repository.name,
      quayBuildId: buildInfo.id,
      quayBuildName: buildInfo.display_name,
      quayBuildAddress: `${this.quayAddress}/repository/${buildInfo.repository.namespace}/${buildInfo.repository.name}/build/${buildInfo.id}`,
      quayBuildLogsAddress: `${this.quayAddress}/buildlogs/${buildInfo.id}`,
      quayBuildStatus: buildInfo.phase,
    }
    this.log.info(
      `start image-build for package: "${packageName}": "${result.quayBuildAddress}" for image: "${
        // eslint-disable-next-line no-process-env
        process.env.NC_TEST_MODE
          ? // in tests, docker-registry is not quay-server.
            `localhost:35000/${buildInfo.repository.namespace}/${buildInfo.repository.name}`
          : buildFullDockerImageName({
              dockerRegistry: this.quayAddress,
              imageName: buildInfo.repository.name,
              dockerOrganizationName: buildInfo.repository.namespace,
            })
      }" with tags: "${imageTags.join(',')}"`,
    )
    return result
  }

  public async createNotification({
    packageName,
    repoName,
    event,
    webhookUrl,
    taskId,
  }: {
    webhookUrl: string
    packageName: string
    repoName: string
    event: QuayNotificationEvents
    taskId: string
  }): Promise<void> {
    await this.request<CreateNotificationResult>({
      taskId,
      method: 'post',
      api: `api/v1/repository/${repoName}/notification/`,
      requestBody: {
        config: { url: webhookUrl },
        event,
        eventConfig: {},
        method: 'webhook',
        title: event,
      },
    })

    this.log.verbose(
      `created notification: ${event} for package: "${packageName}" - repository: "${buildFullDockerImageName({
        dockerRegistry: this.quayAddress,
        imageName: repoName,
        dockerOrganizationName: this.quayNamespace,
      })}"`,
    )
  }
}
