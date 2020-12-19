import { Log, LogLevel } from '@tahini/core'
import { getDockerImageLabelsAndTags } from '@tahini/steps'
import { winstonLogger } from '@tahini/loggers'
import { getPackages } from '@tahini/utils'
import execa from 'execa'
import path from 'path'
import semver from 'semver'
import { ResultingArtifact, TestResources } from './types'

async function latestNpmPackageDistTags(
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

async function latestNpmPackageVersion(packageName: string, npmRegistry: string): Promise<string | undefined> {
  const distTags = await latestNpmPackageDistTags(packageName, npmRegistry)
  return distTags?.['latest']
}

async function publishedNpmPackageVersions(packageName: string, npmRegistry: string): Promise<Array<string>> {
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

async function publishedDockerImageTags({
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

export const getPublishResult = async ({
  toOriginalName,
  repoPath,
  getResources,
}: {
  toOriginalName: (artifactName: string) => string
  repoPath: string
  getResources: () => TestResources
}): Promise<Map<string, ResultingArtifact>> => {
  const logger = await winstonLogger({
    customLogLevel: LogLevel.trace,
    disabled: true,
    logFilePath: './nc.log',
  }).callInitializeLogger({ repoPath })
  const log = logger.createLog('test')
  const packagesPaths = await getPackages({ repoPath, log })
  const packages = await Promise.all(
    packagesPaths // todo: need to search in runtime which packages I have NOW
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      .map(packagePath => require(path.join(packagePath, 'package.json')).name)
      .map<Promise<[string, ResultingArtifact]>>(async (packageName: string) => {
        const [versions, highestVersion, tags] = await Promise.all([
          publishedNpmPackageVersions(packageName, getResources().npmRegistry.address),
          latestNpmPackageVersion(packageName, getResources().npmRegistry.address),
          publishedDockerImageTags({
            imageName: packageName,
            dockerOrganizationName: getResources().quayNamespace,
            dockerRegistry: getResources().dockerRegistry,
            repoPath,
            log,
          }),
        ])
        return [
          toOriginalName(packageName),
          {
            npm: {
              versions,
              highestVersion,
            },
            docker: {
              tags,
            },
          },
        ]
      }),
  )

  const published = packages.filter(
    ([, artifact]) =>
      artifact.docker.tags.length > 0 || artifact.npm.versions.length > 0 || artifact.npm.highestVersion,
  )
  return new Map(published)
}
