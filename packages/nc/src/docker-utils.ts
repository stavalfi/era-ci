import execa from 'execa'
import { logger } from '@tahini/log'
import { ServerInfo, TargetsPublishAuth, TargetType } from './types'
import { getHighestDockerTag } from './versions'
import isIp from 'is-ip'
import _ from 'lodash'

const log = logger('docker-utils')

export async function dockerRegistryLogin({
  repoPath,
  dockerRegistry,
  dockerRegistryToken,
  dockerRegistryUsername,
}: {
  repoPath: string
  dockerRegistryUsername?: string
  dockerRegistryToken?: string
  dockerRegistry: ServerInfo
}) {
  if (dockerRegistryUsername && dockerRegistryToken) {
    const withPort =
      isIp.v4(dockerRegistry.host) || dockerRegistry.host === 'localhost' ? `:${dockerRegistry.port}` : ''
    const dockerRegistryAddress = `${dockerRegistry.protocol}://${dockerRegistry.host}${withPort}`
    log.verbose(`logging in to docker-registry: ${dockerRegistryAddress}`)
    // I need to login to read and push from `dockerRegistryUsername` repository
    await execa.command(
      `docker login --username=${dockerRegistryUsername} --password=${dockerRegistryToken} ${dockerRegistryAddress}`,
      {
        stdio: 'pipe',
        cwd: repoPath,
      },
    )
    log.verbose('logged in to docker-registry')
  }
}

export const buildDockerImageName = (packageJsonName: string) => {
  return packageJsonName.replace('/', '-').replace('@', '')
}

async function runSkopeoCommand(command: string, repoPath: string): Promise<string> {
  const { stdout: result } = await execa.command(`skopeo ${command}`, { cwd: repoPath })
  return result
}

export const buildFullDockerImageName = ({
  dockerOrganizationName,
  dockerRegistry,
  packageJsonName,
  imageTag,
}: {
  dockerRegistry: ServerInfo
  dockerOrganizationName: string
  packageJsonName: string
  imageTag?: string
}) => {
  const withPort = isIp.v4(dockerRegistry.host) || dockerRegistry.host === 'localhost' ? `:${dockerRegistry.port}` : ''
  const withImageTag = imageTag ? `:${imageTag}` : ''
  return `${dockerRegistry.host}${withPort}/${dockerOrganizationName}/${buildDockerImageName(
    packageJsonName,
  )}${withImageTag}`
}

/*
todo: remove skopeo and use docker v2 api. it's not working when trying to use the following commands with unsecure-local-registry

#!/usr/bin/env bash
repo=stavalfi/simple-service                                                                                                                                                                              
token=$(curl -s "https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repo}:pull" | jq -r '.token')
digest=$(curl -s -H "Accept: application/vnd.docker.distribution.manifest.v2+json" -H "Authorization: Bearer $token" "https://registry-1.docker.io/v2/${repo}/manifests/latest" | jq .config.digest -r)
curl -s -L -H "Accept: application/vnd.docker.distribution.manifest.v2+json" -H "Authorization: Bearer $token" "https://registry-1.docker.io/v2/${repo}/blobs/$digest" | jq .config.Labels
*/
export async function getDockerImageLabelsAndTags({
  packageJsonName,
  dockerOrganizationName,
  dockerRegistry,
  silent,
  publishAuth,
  repoPath,
}: {
  packageJsonName: string
  dockerOrganizationName: string
  dockerRegistry: ServerInfo
  silent?: boolean
  publishAuth: TargetsPublishAuth[TargetType.docker]
  repoPath: string
}): Promise<{ latestHash?: string; latestTag?: string; allTags: string[] } | undefined> {
  const fullImageNameWithoutTag = buildFullDockerImageName({
    dockerOrganizationName,
    dockerRegistry,
    packageJsonName,
  })
  try {
    if (!silent) {
      log.verbose(`searching for all tags for image: "${fullImageNameWithoutTag}"`)
    }
    const withAuth =
      publishAuth.username && publishAuth.token ? `--creds ${publishAuth.username}:${publishAuth.token}` : ''
    const tagsResult = await runSkopeoCommand(
      `list-tags ${withAuth} ${
        dockerRegistry.protocol === 'http' ? '--tls-verify=false' : ''
      } docker://${fullImageNameWithoutTag}`,
      repoPath,
    )
    const tagsResultJson = JSON.parse(tagsResult || '{}')
    const allTags = tagsResultJson?.Tags || []

    const highestPublishedTag = getHighestDockerTag(allTags)

    const fullImageName = buildFullDockerImageName({
      dockerOrganizationName,
      dockerRegistry,
      packageJsonName,
      imageTag: highestPublishedTag,
    })

    if (!silent) {
      log.verbose(`searching the latest tag and hash for image "${fullImageName}"`)
    }

    const stdout = await runSkopeoCommand(
      `inspect ${withAuth} ${dockerRegistry.protocol === 'http' ? '--tls-verify=false' : ''} docker://${fullImageName}`,
      repoPath,
    )

    const LabelsResult = JSON.parse(stdout)
    const labels = LabelsResult.Labels || {}

    if (!silent) {
      log.verbose(`labels of image "${fullImageName}": ${JSON.stringify(labels, null, 2)}`)
    }
    const result = {
      latestHash: labels['latest-hash'],
      latestTag: labels['latest-tag'],
      allTags,
    }

    if (!silent) {
      log.verbose(
        `latest tag and hash for "${fullImageName}" are: "${JSON.stringify(_.omit(result, ['allTags']), null, 2)}"`,
      )
      if (!result.latestHash || !result.latestTag) {
        log.verbose(
          `one of ${JSON.stringify(
            result,
            null,
            2,
          )} is falsy for image "${fullImageName}". maybe someone in your team manually did that or we have a bug. anyways we have a fall-back plan - don't worry.`,
        )
      }
    }
    return result
  } catch (e) {
    if (
      e.stderr?.includes('manifest unknown') ||
      e.stderr?.includes('unable to retrieve auth token') ||
      e.stderr?.includes('invalid status code from registry 404 (Not Found)')
    ) {
      if (!silent) {
        log.verbose(`"${fullImageNameWithoutTag}" weren't published before so we can't find this image`)
      }
    } else {
      throw e
    }
  }
}

export async function isDockerVersionAlreadyPulished({
  packageName,
  imageTag,
  dockerOrganizationName,
  dockerRegistry,
  publishAuth,
  repoPath,
}: {
  packageName: string
  imageTag: string
  dockerRegistry: ServerInfo
  dockerOrganizationName: string
  publishAuth: TargetsPublishAuth[TargetType.docker]
  repoPath: string
}) {
  const fullImageName = buildFullDockerImageName({
    dockerOrganizationName,
    dockerRegistry,
    packageJsonName: packageName,
    imageTag,
  })
  try {
    const withAuth =
      publishAuth.username && publishAuth.token ? `--creds ${publishAuth.username}:${publishAuth.token}` : ''

    await runSkopeoCommand(
      `inspect ${withAuth} ${dockerRegistry.protocol === 'http' ? '--tls-verify=false' : ''} docker://${fullImageName}`,
      repoPath,
    )
    return true
  } catch (e) {
    if (
      e.stderr?.includes('manifest unknown') ||
      e.stderr?.includes('unable to retrieve auth token') ||
      e.stderr?.includes('invalid status code from registry 404 (Not Found)')
    ) {
      return false
    } else {
      throw e
    }
  }
}
