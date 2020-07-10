import execa from 'execa'
import ncLog from '@tahini/log'
import { ServerInfo } from './types'
import { getHighestDockerTag } from './versions'
import isIp from 'is-ip'

const log = ncLog('ci:docker-utils')

export async function dockerRegistryLogin({
  dockerRegistry,
  dockerRegistryToken,
  dockerRegistryUsername,
}: {
  dockerRegistryUsername?: string
  dockerRegistryToken?: string
  dockerRegistry: ServerInfo
}) {
  if (dockerRegistryUsername && dockerRegistryToken) {
    const withPort =
      isIp.v4(dockerRegistry.host) || dockerRegistry.host === 'localhost' ? `:${dockerRegistry.port}` : ''
    const dockerRegistryAddress = `${dockerRegistry.protocol}://${dockerRegistry.host}${withPort}`
    log('logging in to docker-registry: %s', `${dockerRegistryAddress}`)
    // I need to login to read and push from `dockerRegistryUsername` repository
    await execa.command(
      `docker login --username=${dockerRegistryUsername} --password=${dockerRegistryToken} ${dockerRegistryAddress}`,
      {
        stdio: 'inherit',
      },
    )
    log('logged in to docker-registry')
  }
}

export const buildDockerImageName = (packageJsonName: string) => {
  return packageJsonName.replace('/', '-').replace('@', '')
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

export async function isDockerHashAlreadyPulished({
  packageName,
  currentPackageHash,
  dockerOrganizationName,
  dockerRegistry,
}: {
  packageName: string
  currentPackageHash: string
  dockerRegistry: ServerInfo
  dockerOrganizationName: string
}) {
  const fullImageNameWithoutTag = buildFullDockerImageName({
    dockerOrganizationName,
    dockerRegistry,
    packageJsonName: packageName,
    imageTag: currentPackageHash,
  })
  try {
    await execa.command(
      `skopeo list-tags ${
        dockerRegistry.protocol === 'http' ? '--tls-verify=false' : ''
      } docker://${fullImageNameWithoutTag}`,
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
}: {
  packageJsonName: string
  dockerOrganizationName: string
  dockerRegistry: ServerInfo
}): Promise<{ latestHash?: string; latestTag?: string; allTags: string[] } | undefined> {
  const fullImageNameWithoutTag = buildFullDockerImageName({
    dockerOrganizationName,
    dockerRegistry,
    packageJsonName,
  })
  try {
    log('searching for all tags for image: "%s"')
    const { stdout: tagsResult } = await execa.command(
      `skopeo list-tags ${
        dockerRegistry.protocol === 'http' ? '--tls-verify=false' : ''
      } docker://${fullImageNameWithoutTag}`,
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

    log('searching the latest tag and hash for image "%s"', fullImageName)

    const { stdout } = await execa.command(
      `skopeo inspect ${dockerRegistry.protocol === 'http' ? '--tls-verify=false' : ''} docker://${fullImageName}`,
    )
    const LabelsResult = JSON.parse(stdout)
    const labels = LabelsResult.Labels || {}

    log(`labels of image "${fullImageName}": ${labels}`)
    const result = {
      latestHash: labels['latest-hash'],
      latestTag: labels['latest-tag'],
      allTags,
    }

    log('latest tag and hash for "%s" are: "%O"', fullImageName, result)
    if (!result.latestHash || !result.latestTag) {
      log(
        `one of %O is falsy. maybe someone in your team manually did that or we have a bug. anyways we have a fall-back plan - don't worry.`,
        result,
        fullImageName,
      )
    }
    return result
  } catch (e) {
    if (
      e.stderr?.includes('manifest unknown') ||
      e.stderr?.includes('unable to retrieve auth token') ||
      e.stderr?.includes('invalid status code from registry 404 (Not Found)')
    ) {
      log(`"%s" weren't published before so we can't find this image`, fullImageNameWithoutTag)
    } else {
      throw e
    }
  }
}