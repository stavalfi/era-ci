import { QuayBuildStatus, QuayNotificationEvents } from '@tahini/quay-task-queue'
import got from 'got'
import { Readable } from 'stream'
import tar from 'tar'
import { Auth, QueryStringOptions } from './types'

function downloadFromGithub(
  options: {
    git_registry: 'bitbucket-cloud' | 'github'
    git_org: string
    git_repo: string
    commit: string
  },
  auth: Auth,
): Readable {
  const url = `https://api.github.com/repos/${options.git_org}/${options.git_repo}/tarball/${options.commit}`
  return got.stream(url, {
    headers: {
      Authorization: `token ${auth.github.token}`,
    },
  })
}

function downloadFromBitbucketCloud(
  options: {
    git_registry: 'bitbucket-cloud' | 'github'
    git_org: string
    git_repo: string
    commit: string
  },
  auth: Auth,
): Readable {
  const url = `https://${auth.bitbucketCloud.username}:${auth.bitbucketCloud.token}@bitbucket.org/${options.git_org}/${options.git_repo}/get/${options.commit}.tar.gz`
  return got.stream(url)
}

function downloadFromLocalFilesystem(repo_abs_path: string): Readable {
  return tar.c({ gzip: true }, [repo_abs_path])
}

export function downloadTarGz(options: QueryStringOptions, auth: Auth): Readable {
  switch (options.git_registry) {
    case 'github':
      return downloadFromGithub(options, auth)
    case 'bitbucket-cloud':
      return downloadFromBitbucketCloud(options, auth)
    case 'local-filesystem':
      return downloadFromLocalFilesystem(options.repo_abs_path)
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
