import { Log } from '@tahini/core'
import { buildFullDockerImageName, calculateNewVersion, execaCommand, PackageJson } from '@tahini/utils'
import _ from 'lodash'
import semver from 'semver'

function getHighestDockerTag(tags: Array<string>): string | undefined {
  const sorted = semver.sort(tags.filter((tag: string) => semver.valid(tag)))
  if (sorted.length > 0) {
    return sorted[sorted.length - 1]
  }
}

async function runSkopeoCommand(
  command: string | [string, ...Array<string>],
  repoPath: string,
  log: Log,
): Promise<string> {
  const { stdout: result } = await execaCommand(command, { cwd: repoPath, stdio: 'pipe', log })
  return result
}

export const getVersionCacheKey = ({ artifactHash }: { artifactHash: string }): string =>
  `${artifactHash}-docker-version`

export const fullImageNameCacheKey = ({ packageHash }: { packageHash: string }): string =>
  `full_image_name_of_artifact_hash-${packageHash}`

export async function calculateNextVersion({
  packageJson,
  imageName,
  dockerOrganizationName,
  dockerRegistry,
  packagePath,
  repoPath,
  log,
}: {
  packageJson: PackageJson
  imageName: string
  dockerRegistry: string
  dockerOrganizationName: string
  packagePath: string
  repoPath: string
  log: Log
}): Promise<string> {
  const dockerLatestTagInfo = await getDockerImageLabelsAndTags({
    dockerRegistry,
    dockerOrganizationName,
    imageName,
    repoPath,
    log,
  })

  return calculateNewVersion({
    packagePath,
    packageJsonVersion: packageJson.version,
    highestPublishedVersion: dockerLatestTagInfo?.latestTag,
    allVersions: dockerLatestTagInfo?.allTags,
  })
}

export async function isDockerVersionAlreadyPublished({
  packageName,
  imageTag,
  dockerOrganizationName,
  dockerRegistry,
  repoPath,
  log,
  registryAuth,
}: {
  packageName: string
  imageTag: string
  dockerRegistry: string
  dockerOrganizationName: string
  repoPath: string
  registryAuth?: {
    username: string
    token: string
  }
  log: Log
}): Promise<boolean> {
  const fullImageName = buildFullDockerImageName({
    dockerOrganizationName,
    dockerRegistry,
    imageName: packageName,
    imageTag,
  })
  const withAuth = registryAuth ? `--creds ${registryAuth.username}:${registryAuth.token}` : ''
  try {
    await runSkopeoCommand(
      `skopeo inspect ${withAuth} ${
        dockerRegistry.includes('http://') ? '--tls-verify=false' : ''
      } docker://${fullImageName}`,
      repoPath,
      log,
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
  imageName,
  dockerOrganizationName,
  dockerRegistry,
  silent,
  repoPath,
  log,
  registryAuth,
}: {
  imageName: string
  dockerOrganizationName: string
  dockerRegistry: string
  silent?: boolean
  repoPath: string
  log: Log
  registryAuth?: {
    username: string
    token: string
  }
}): Promise<
  { latestHash?: string; latestTag?: string; allTags: Array<string>; allValidTagsSorted: Array<string> } | undefined
> {
  const fullImageNameWithoutTag = buildFullDockerImageName({
    dockerOrganizationName,
    dockerRegistry,
    imageName,
  })
  const withAuth = registryAuth ? `--creds ${registryAuth.username}:${registryAuth.token}` : ''

  try {
    if (!silent) {
      log.verbose(`searching for all tags for image: "${fullImageNameWithoutTag}"`)
    }
    const tagsResult = await runSkopeoCommand(
      `skopeo list-tags ${withAuth} ${
        dockerRegistry.includes('http://') ? '--tls-verify=false' : ''
      } docker://${fullImageNameWithoutTag}`,
      repoPath,
      log,
    )
    const tagsResultJson = JSON.parse(tagsResult || '{}')
    const allTags: Array<string> = tagsResultJson?.Tags || []

    const highestPublishedTag = getHighestDockerTag(allTags)

    const fullImageName = buildFullDockerImageName({
      dockerOrganizationName,
      dockerRegistry,
      imageName,
      imageTag: highestPublishedTag,
    })

    if (!silent) {
      log.verbose(`searching the latest tag and hash for image "${fullImageName}"`)
    }

    const stdout = await runSkopeoCommand(
      `skopeo inspect ${withAuth} ${
        dockerRegistry.includes('http://') ? '--tls-verify=false' : ''
      } docker://${fullImageName}`,
      repoPath,
      log,
    )

    const LabelsResult = JSON.parse(stdout)
    const labels = LabelsResult.Labels || {}

    if (!silent) {
      log.verbose(`labels of image "${fullImageName}": ${JSON.stringify(labels, null, 2)}`)
    }

    const tags = allTags.filter((tag: string) => semver.valid(tag) || tag === 'latest').filter(Boolean)
    const sorted = semver.sort(tags.filter(tag => tag !== 'latest')).concat(tags.includes('latest') ? ['latest'] : [])

    const result = {
      latestHash: labels['latest-hash'],
      latestTag: labels['latest-tag'],
      allTags,
      allValidTagsSorted: sorted,
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
