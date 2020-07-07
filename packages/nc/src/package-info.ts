import fs from 'fs-extra'
import { Redis } from 'ioredis'
import { IPackageJson } from 'package-json-type'
import path from 'path'
import { getDockerImageLabelsAndTags, isDockerHashAlreadyPulished } from './docker-utils'
import { getNpmLatestVersionInfo, isNpmHashAlreadyPulished } from './npm-utils'
import { PackageInfo, ServerInfo, TargetInfo, TargetType } from './types'
import { calculateNewVersion } from './versions'

async function isNpmTarget({
  packageJson,
  npmRegistry,
  redisClient,
  packageHash,
  packagePath,
}: {
  packageJson: IPackageJson
  npmRegistry: ServerInfo
  redisClient: Redis
  packageHash: string
  packagePath: string
}): Promise<TargetInfo<TargetType.npm> | undefined> {
  const isNpm = !packageJson.private
  if (isNpm) {
    if (!packageJson.name) {
      throw new Error(`package.json of: ${packagePath} must have a name property.`)
    }
    if (!packageJson.version) {
      throw new Error(`package.json of: ${packagePath} must have a version property.`)
    }
    const needPublish = await isNpmHashAlreadyPulished(packageJson.name, packageHash, npmRegistry)
    const npmLatestVersionInfo = await getNpmLatestVersionInfo(packageJson.name, npmRegistry, redisClient)
    if (needPublish) {
      return {
        targetType: TargetType.npm,
        needPublish: true,
        newVersion: calculateNewVersion({
          packagePath,
          packageJsonVersion: packageJson.version,
          latestPublishedVersion: npmLatestVersionInfo?.latestVersion,
          allVersions: npmLatestVersionInfo?.allVersions,
        }),
        latestPublishedVersion: npmLatestVersionInfo && {
          version: npmLatestVersionInfo?.latestVersion,
          hash: npmLatestVersionInfo?.latestVersionHash,
        },
      }
    } else {
      return {
        targetType: TargetType.npm,
        needPublish: false,
        latestPublishedVersion: npmLatestVersionInfo && {
          version: npmLatestVersionInfo?.latestVersion,
          hash: npmLatestVersionInfo?.latestVersionHash,
        },
      }
    }
  }
}

async function isDockerTarget({
  packageJson,
  dockerOrganizationName,
  dockerRegistry,
  redisClient,
  packageHash,
  packagePath,
}: {
  packageJson: IPackageJson
  dockerRegistry: ServerInfo
  dockerOrganizationName: string
  redisClient: Redis
  packageHash: string
  packagePath: string
}): Promise<TargetInfo<TargetType.docker> | undefined> {
  // @ts-ignore
  const isDocker: boolean = await fs.exists(path.join(packagePath, 'Dockerfile'))
  if (isDocker) {
    if (!packageJson.name) {
      throw new Error(`package.json of: ${packagePath} must have a name property.`)
    }
    if (!packageJson.version) {
      throw new Error(`package.json of: ${packagePath} must have a version property.`)
    }
    const needPublish = await isDockerHashAlreadyPulished({
      currentPackageHash: packageHash,
      dockerOrganizationName,
      dockerRegistry,
      packageName: packageJson.name,
    })
    const dockerLatestTagInfo = await getDockerImageLabelsAndTags({
      dockerRegistry,
      dockerOrganizationName,
      packageJsonName: packageJson.name,
    })

    if (needPublish) {
      return {
        targetType: TargetType.docker,
        needPublish: true,
        newVersion: calculateNewVersion({
          packagePath,
          packageJsonVersion: packageJson.version,
          latestPublishedVersion: dockerLatestTagInfo?.latestTag,
          allVersions: dockerLatestTagInfo?.allTags,
        }),
        latestPublishedVersion: dockerLatestTagInfo && {
          version: dockerLatestTagInfo.latestTag,
          hash: dockerLatestTagInfo.latestHash,
        },
      }
    } else {
      return {
        targetType: TargetType.docker,
        needPublish: false,
        latestPublishedVersion: dockerLatestTagInfo && {
          version: dockerLatestTagInfo.latestTag,
          hash: dockerLatestTagInfo.latestHash,
        },
      }
    }
  }
}

export async function getPackageInfo({
  dockerOrganizationName,
  packageHash,
  packagePath,
  relativePackagePath,
  redisClient,
  dockerRegistry,
  npmRegistry,
}: {
  relativePackagePath: string
  packagePath: string
  packageHash: string
  npmRegistry: ServerInfo
  dockerRegistry: ServerInfo
  dockerOrganizationName: string
  redisClient: Redis
}): Promise<PackageInfo> {
  const packageJson: IPackageJson = await fs.readJson(path.join(packagePath, 'package.json'))

  const [npmTarget, dockerTarget] = await Promise.all([
    isNpmTarget({
      packageHash,
      packagePath,
      redisClient,
      npmRegistry,
      packageJson,
    }),
    isDockerTarget({
      packageHash,
      packagePath,
      redisClient,
      dockerOrganizationName,
      dockerRegistry,
      packageJson,
    }),
  ])

  return {
    relativePackagePath,
    packagePath,
    packageJson,
    packageHash,
    target: npmTarget || dockerTarget,
  }
}
