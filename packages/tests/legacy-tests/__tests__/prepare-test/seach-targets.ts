import execa from 'execa'
import semver from 'semver'
import { Log } from '@tahini/core'
import { getDockerImageLabelsAndTags } from '@tahini/steps'

export async function latestNpmPackageDistTags(
  packageName: string,
  npmRegistry: string,
): Promise<{ [key: string]: string } | undefined> {
  try {
    const result = await execa.command(`npm view ${packageName} --json --registry ${npmRegistry}`, {
      stdio: 'pipe',
    })
    const resultJson = JSON.parse(result.stdout) || {}
    const distTags = resultJson['dist-tags'] as { [key: string]: string }
    return distTags
  } catch (e) {
    if (!e.message.includes('code E404')) {
      throw e
    }
  }
}

export async function latestNpmPackageVersion(packageName: string, npmRegistry: string): Promise<string | undefined> {
  const distTags = await latestNpmPackageDistTags(packageName, npmRegistry)
  return distTags?.['latest']
}

export async function publishedNpmPackageVersions(packageName: string, npmRegistry: string): Promise<Array<string>> {
  try {
    const npmRegistryAddress = npmRegistry
    const command = `npm view ${packageName} --json --registry ${npmRegistryAddress}`
    const result = await execa.command(command, { stdio: 'pipe' })
    const resultJson = JSON.parse(result.stdout) || {}
    return resultJson.versions
  } catch (e) {
    if (e.message.includes('code E404')) {
      return []
    } else {
      throw e
    }
  }
}

export async function publishedDockerImageTags({
  dockerOrganizationName,
  log,
  repoPath,
  dockerRegistry,
  imageName,
}: {
  imageName: string
  dockerOrganizationName: string
  dockerRegistry: string
  repoPath: string
  log: Log
}): Promise<Array<string>> {
  try {
    const result = await getDockerImageLabelsAndTags({
      dockerOrganizationName,
      imageName,
      dockerRegistry,
      silent: true,
      repoPath,
      log,
    })
    const tags = result?.allTags.filter((tag: string) => semver.valid(tag) || tag === 'latest').filter(Boolean) || []
    const sorted = semver.sort(tags.filter(tag => tag !== 'latest')).concat(tags.includes('latest') ? ['latest'] : [])
    return sorted
  } catch (e) {
    if (e.stderr?.includes('manifest unknown')) {
      return []
    } else {
      throw e
    }
  }
}
