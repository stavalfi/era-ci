import got from 'got'
import path from 'path'
import { Log, buildFullDockerImageName } from '@tahini/nc'
import { AbortEventHandler } from './types'

export enum QuayBuildStatus {
  waiting = 'waiting',
  started = 'started', // this is not confirmed. can't find in the docs what it is
  complete = 'complete',
  error = 'error',
}

export type QuayCreateRepoResult = { kind: 'image'; namespace: string; name: string }

export type QuayNewBuildResult = {
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
  phase: QuayBuildStatus
  resource_key: null
  manual_user: string
  id: '5a513d5d-9d01-49a8-8325-2a3bd4c446e3'
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

export class QuayClient {
  constructor(
    private readonly abortEventHandler: AbortEventHandler,
    private readonly quayAddress: string,
    private readonly quayToken: string,
    private readonly quayNamespace: string,
    private readonly log: Log,
  ) {}

  public async createRepo({
    packageName,
    repoName,
    visibility,
    timeoutMs,
  }: {
    packageName: string
    repoName: string
    visibility: 'public' | 'private'
    timeoutMs: number
  }): Promise<QuayCreateRepoResult> {
    const p = got.post<QuayCreateRepoResult>(`${this.quayAddress}/api/v1/repository`, {
      headers: {
        Authorization: `Bearer ${this.quayToken}`,
      },
      json: {
        repo_kind: 'image',
        namespace: this.quayNamespace,
        visibility,
        repository: repoName,
        description: `image repository to package: ${packageName}`,
      },
      responseType: 'json',
      resolveBodyOnly: true,
      timeout: timeoutMs,
    })

    this.abortEventHandler.once('closed', () => p.cancel())

    return p.then(
      r => {
        this.log.info(
          `created image-repository: "${this.quayAddress}/repository/${r.namespace}/${r.name}" for package: "${packageName}" with visibility: "${visibility}"`,
        )
        return r
      },
      error => {
        if (error.response.body.error_message === 'Repository already exists') {
          return {
            kind: 'image',
            namespace: this.quayNamespace,
            name: repoName,
          }
        } else {
          throw error
        }
      },
    )
  }

  public async getBuildStatus({
    quayBuildId,
    timeoutMs,
  }: {
    quayBuildId: string
    timeoutMs: number
  }): Promise<QuayNewBuildResult['phase']> {
    const p = got.get<QuayNewBuildResult>(`${this.quayAddress}/api/v1/repository/build/${quayBuildId}/status`, {
      headers: {
        Authorization: `Bearer ${this.quayToken}`,
      },
      responseType: 'json',
      resolveBodyOnly: true,
      timeout: timeoutMs,
    })

    this.abortEventHandler.once('closed', () => p.cancel())

    const quayBuildStatus = await p
    return quayBuildStatus.phase
  }

  public async cancelBuild({
    quayBuildId,
    timeoutMs,
    packageName,
  }: {
    quayBuildId: string
    timeoutMs: number
    packageName: string
  }): Promise<void> {
    const p = got.delete<QuayNewBuildResult>(`${this.quayAddress}/api/v1/repository/build/${quayBuildId}`, {
      headers: {
        Authorization: `Bearer ${this.quayToken}`,
      },
      responseType: 'json',
      resolveBodyOnly: true,
      timeout: timeoutMs,
    })
    this.abortEventHandler.once('closed', () => p.cancel())
    await p
    this.log.info(`canceled image-build for package: "${packageName}" in quay`)
  }

  public async triggerBuild({
    repoName,
    relativeContextPath,
    relativeDockerfilePath,
    imageTags,
    packageName,
    archiveUrl,
    commit,
    timeoutMs,
  }: {
    repoName: string
    commit: string
    packageName: string
    relativeContextPath: string
    relativeDockerfilePath: string
    imageTags: string[]
    archiveUrl: string
    timeoutMs: number
  }): Promise<BuildTriggerResult> {
    const p = got.post<QuayNewBuildResult>(
      `${this.quayAddress}/api/v1/repository/${this.quayNamespace}/${repoName}/build/`,
      {
        headers: {
          Authorization: `Bearer ${this.quayToken}`,
        },
        json: {
          archive_url: archiveUrl,
          docker_tags: imageTags,
          context: path.join(`/${repoName}-${commit}`, relativeContextPath),
          dockerfile_path: path.join(`/${repoName}-${commit}`, relativeDockerfilePath),
        },
        responseType: 'json',
        resolveBodyOnly: true,
        timeout: timeoutMs,
      },
    )
    this.abortEventHandler.once('closed', () => p.cancel())

    const buildInfo = await p

    const result = {
      quayRepoName: buildInfo.repository.name,
      quayBuildId: buildInfo.id,
      quayBuildName: buildInfo.display_name,
      quayBuildAddress: `${this.quayAddress}/repository/${buildInfo.repository.namespace}/${buildInfo.repository.name}/build/${buildInfo.id}`,
      quayBuildLogsAddress: `${this.quayAddress}/buildlogs/${buildInfo.id}`,
      quayBuildStatus: buildInfo.phase,
    }
    this.log.info(
      `start image-build for package: "${packageName}": "${
        result.quayBuildAddress
      }" for image: "${buildFullDockerImageName({
        dockerRegistry: this.quayAddress,
        imageName: buildInfo.repository.name,
        dockerOrganizationName: buildInfo.repository.namespace,
      })}" with tags: "${imageTags.join(',')}"`,
    )
    return result
  }
}
