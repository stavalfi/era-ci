import { buildFullDockerImageName } from '@era-ci/utils'
import { EventEmitter } from 'events'
import got, { RequestError } from 'got'
import HttpStatusCodes from 'http-status-codes'
import {
  AbortEventHandler,
  BuildTriggerResult,
  CreateNotificationResult,
  NotificationsListResult,
  QuayCreateRepoResult,
  QuayNewBuildResult,
  QuayNotificationEvents,
  TaskTimeoutEventEmitter,
} from './types'
import urlJoin from 'url-join'
export * from './types'

export class QuayClient {
  constructor(
    private readonly quayService: string,
    private readonly quayToken: string,
    private readonly quayNamespace: string,
    private readonly log: {
      info: (s: string) => void
      debug: (s: string) => void
      error: (s: string, e: Error) => void
    },
    private readonly processEnv: NodeJS.ProcessEnv,
    private readonly taskTimeoutEventEmitter: TaskTimeoutEventEmitter = new EventEmitter({ captureRejections: true }),
    private readonly abortEventHandler: AbortEventHandler = new EventEmitter({ captureRejections: true }),
  ) {}

  private async request<ResponseBody, RequestBody = unknown>(options: {
    method: 'get' | 'post' | 'delete'
    api: string
    requestBody?: RequestBody
    taskId: string
  }): Promise<ResponseBody> {
    const url = urlJoin(this.quayService, options.api)
    const p = got[options.method]<ResponseBody>(url, {
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

    const closed = () => p.cancel()
    const timeout = (taskId: string) => {
      if (taskId === options.taskId) {
        p.cancel()
      }
    }

    this.abortEventHandler.once('closed', closed)
    this.taskTimeoutEventEmitter.once('timeout', timeout)

    return p.finally(() => {
      this.abortEventHandler.off('closed', closed)
      this.taskTimeoutEventEmitter.off('timeout', timeout)
    })
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
        `created quay-repository: "${this.quayService}/repository/${r.namespace}/${r.name}" for package: "${packageName}" with visibility: "${visibility}"`,
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
        this.log.error(`failed to create repo: "${repoName}" for package: "${packageName}"`, error)
        throw error
      }
    }
  }

  public async getBuildStatus({
    quayBuildId,
    taskId,
    repoName,
  }: {
    repoName: string
    quayBuildId: string
    taskId: string
  }): Promise<QuayNewBuildResult['phase']> {
    const quayBuildStatus = await this.request<QuayNewBuildResult>({
      taskId,
      method: 'get',
      api: `api/v1/repository/${this.quayNamespace}/${repoName}/build/${quayBuildId}/status`,
    }).catch(e => {
      this.log.error(
        `failed to get build-status for quay-repo: "${repoName}" .quay-build-id: "${quayBuildId}": "${e}"`,
        e,
      )
      throw e
    })

    return quayBuildStatus.phase
  }

  public async cancelBuild({
    quayBuildId,
    packageName,
    repoName,
    taskId,
  }: {
    repoName: string
    quayBuildId: string
    packageName: string
    taskId: string
  }): Promise<void> {
    await this.request({
      taskId,
      method: 'delete',
      api: `api/v1/repository/${this.quayNamespace}/${repoName}/build/${quayBuildId}`,
    }).catch(e => {
      this.log.error(`failed to cancel build for quay-repo: "${repoName}" .quay-build-id: "${quayBuildId}"`, e)
      throw e
    })

    this.log.info(`canceled image-build for package: "${packageName}" in quay`)
  }

  public async triggerBuild({
    quayRepoName,
    relativeContextPath,
    relativeDockerfilePath,
    imageTags,
    packageName,
    archiveUrl,
    taskId,
  }: {
    quayRepoName: string
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
        context: relativeContextPath,
        dockerfile_path: relativeDockerfilePath,
      },
    }).catch(e => {
      this.log.error(`failed to trigger build for quay-repo: "${quayRepoName}"`, e)
      throw e
    })

    const result = {
      quayRepoName: buildInfo.repository.name,
      quayBuildId: buildInfo.id,
      quayBuildName: buildInfo.display_name,
      quayBuildAddress: `${this.quayService}/repository/${buildInfo.repository.namespace}/${buildInfo.repository.name}/build/${buildInfo.id}`,
      quayBuildLogsAddress: `${this.quayService}/buildlogs/${buildInfo.id}`,
      quayBuildStatus: buildInfo.phase,
    }
    this.log.info(
      `started image-build for package: "${packageName}": "${result.quayBuildAddress}" for image: "${
        this.processEnv.ERA_TEST_MODE
          ? // in tests, docker-registry is not quay-server.
            `localhost:35000/${buildInfo.repository.namespace}/${buildInfo.repository.name}`
          : buildFullDockerImageName({
              dockerRegistry: this.quayService,
              imageName: buildInfo.repository.name,
              dockerOrganizationName: buildInfo.repository.namespace,
            })
      }" with tags: "${imageTags.join(',')}"`,
    )
    return result
  }

  public async getNotifications({
    repoName,
    org,
    taskId,
  }: {
    org: string
    repoName: string
    taskId: string
  }): Promise<NotificationsListResult> {
    return this.request<NotificationsListResult>({
      taskId,
      method: 'get',
      api: `api/v1/repository/${org}/${repoName}/notification/`,
    }).catch(e => {
      this.log.error(`failed to get all notifications of quay-repo: "${repoName}"`, e)
      throw e
    })
  }

  public async createNotification({
    packageName,
    repoName,
    event,
    org,
    webhookUrl,
    taskId,
  }: {
    webhookUrl: string
    packageName: string
    repoName: string
    org: string
    event: QuayNotificationEvents
    taskId: string
  }): Promise<void> {
    await this.request<CreateNotificationResult>({
      taskId,
      method: 'post',
      api: `api/v1/repository/${org}/${repoName}/notification/`,
      requestBody: {
        config: { url: webhookUrl },
        event,
        eventConfig: {},
        method: 'webhook',
        title: event,
      },
    }).catch(e => {
      this.log.error(`failed to create a notification for package: "${packageName}"`, e)
      throw e
    })

    this.log.debug(
      `created notification: ${event} for quay-repo: "${repoName}" - repository: "${buildFullDockerImageName({
        dockerRegistry: this.quayService,
        imageName: repoName,
        dockerOrganizationName: this.quayNamespace,
      })}"`,
    )
  }
}
