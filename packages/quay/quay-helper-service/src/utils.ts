import { Auth, QueryStringOptions } from './types'
import got from 'got'
import Request from 'got/dist/source/core'

function downloadFromGithub(options: QueryStringOptions, auth: Auth) {
  const url = `https://api.github.com/repos/${options.git_org}/${options.git_repo}/tarball/${options.commit}`
  return got.stream(url, {
    headers: {
      Authorization: `token ${auth.github.token}`,
    },
  })
}

function downloadFromBitbucketCloud(options: QueryStringOptions, auth: Auth) {
  const url = `https://${auth.bitbucketCloud.username}:${auth.bitbucketCloud.token}@bitbucket.org/${options.git_org}/${options.git_repo}/get/${options.commit}.tar.gz`
  return got.stream(url)
}

export function downloadTarGz(options: QueryStringOptions, auth: Auth): Request {
  switch (options.git_registry) {
    case 'github':
      return downloadFromGithub(options, auth)
    case 'bitbucket-cloud':
      return downloadFromBitbucketCloud(options, auth)
  }
}
