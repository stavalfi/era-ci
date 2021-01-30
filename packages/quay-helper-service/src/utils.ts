import compressing from 'compressing'
import { createFolder } from 'create-folder-structure'
import execa from 'execa'
import fs from 'fs'
import got from 'got'
import path from 'path'
import { Readable } from 'stream'
import {
  Auth,
  Config,
  QuayBuildStatus,
  QuayBuildStatusChangedTopicPayload,
  QuayNotificationEvents,
  QueryStringOptions,
} from './types'
import Redis from 'ioredis'
import { FastifyLoggerInstance } from 'fastify'

function buildGithubUrl(options: {
  git_registry: 'bitbucket-cloud' | 'github'
  git_org: string
  git_repo: string
  commit: string
}): string {
  return `https://api.github.com/repos/${options.git_org}/${options.git_repo}/tarball/${options.commit}`
}

function buildBitbucketCloudUrl({
  auth,
  options,
}: {
  options: {
    git_registry: 'bitbucket-cloud' | 'github'
    git_org: string
    git_repo: string
    commit: string
  }
  auth: Auth
}): string {
  return `https://${auth.bitbucketCloud.username}:${auth.bitbucketCloud.token}@bitbucket.org/${options.git_org}/${options.git_repo}/get/${options.commit}.tar.gz`
}

async function downloadFromLocalFilesystem(repo_abs_path: string): Promise<Readable> {
  const { stdout: gitRepoName } = await execa.command(`basename $(git remote get-url origin) .git`, {
    shell: true,
    cwd: repo_abs_path,
  })
  const { stdout: gitHeadCommit } = await execa.command(`git rev-parse HEAD`, {
    shell: true,
    cwd: repo_abs_path,
  })

  const newLocation = path.join(await createFolder(), `${gitRepoName}-${gitHeadCommit.slice(0, 8)}`)

  await fs.promises.symlink(repo_abs_path, newLocation)

  const tarStream = new compressing.tar.Stream()
  tarStream.addEntry(newLocation)
  return tarStream
}

export async function downloadTarGz(options: QueryStringOptions, auth: Auth): Promise<Readable> {
  switch (options.git_registry) {
    case 'github':
      return got.stream(buildGithubUrl(options), {
        headers: {
          Authorization: `token ${auth.github.token}`,
        },
      })
    case 'bitbucket-cloud':
      return got.stream(buildBitbucketCloudUrl({ options, auth }))
    case 'local-filesystem':
      return downloadFromLocalFilesystem(options.repo_abs_path)
  }
}

export async function checkTarGzExist(options: QueryStringOptions, auth: Auth): Promise<boolean> {
  switch (options.git_registry) {
    case 'github':
      return got
        .head(buildGithubUrl(options), {
          headers: {
            Authorization: `token ${auth.github.token}`,
          },
        })
        .then(
          () => true,
          () => false,
        )
    case 'bitbucket-cloud':
      return got.head(buildBitbucketCloudUrl({ options, auth })).then(
        () => true,
        () => false,
      )
    case 'local-filesystem':
      return fs.existsSync(options.repo_abs_path)
  }
}

export function quayNotificationEventToBuildStatus(event: QuayNotificationEvents): QuayBuildStatus {
  switch (event) {
    case QuayNotificationEvents.buildCancelled:
      return QuayBuildStatus.cancelled
    case QuayNotificationEvents.buildFailure:
      return QuayBuildStatus.error
    case QuayNotificationEvents.buildQueued:
      return QuayBuildStatus.waiting
    case QuayNotificationEvents.buildStart:
      return QuayBuildStatus.started
    case QuayNotificationEvents.buildSuccess:
      return QuayBuildStatus.complete
  }
}

export async function sendQuayNotificationInRedis({
  config,
  redisConnection,
  build_id,
  quayBuildStatus,
  log,
}: {
  quayBuildStatus: QuayBuildStatus
  build_id: string
  config: Config
  redisConnection: Redis.Redis
  log: FastifyLoggerInstance
}) {
  const payload: QuayBuildStatusChangedTopicPayload = {
    quayBuildId: build_id,
    quayBuildStatus,
    changeDateMs: Date.now(),
  }
  await redisConnection.publish(config.quayBuildStatusChangedRedisTopic, JSON.stringify(payload))
  log.info(`sent build-event from quay: ${JSON.stringify(payload, null, 2)}`)
}
