import fs from 'fs-extra'
import { IPackageJson } from 'package-json-type'
import path from 'path'
import { getDockerImageLabelsAndTags } from './docker-utils'
import { getNpmhighestVersionInfo } from './npm-utils'
import { Cache, PackageInfo, ServerInfo, TargetInfo, TargetType } from './types'
import { calculateNewVersion } from './versions'

async function buildNpmTarget({
  packageJson,
  npmRegistry,
  packageHash,
  packagePath,
  cache,
}: {
  packageJson: IPackageJson
  npmRegistry: ServerInfo
  packageHash: string
  packagePath: string
  cache: Cache
}): Promise<TargetInfo<TargetType.npm>> {
  if (!packageJson.name) {
    throw new Error(`package.json of: ${packagePath} must have a name property.`)
  }
  if (!packageJson.version) {
    throw new Error(`package.json of: ${packagePath} must have a version property.`)
  }
  const publishedVersion = await cache.publish.npm.isPublished(packageJson.name as string, packageHash)
  const needPublish = !publishedVersion
  const npmhighestVersionInfo = await getNpmhighestVersionInfo(packageJson.name, npmRegistry)
  if (needPublish) {
    return {
      targetType: TargetType.npm,
      needPublish: true,
      newVersion: calculateNewVersion({
        packagePath,
        packageJsonVersion: packageJson.version,
        highestPublishedVersion: npmhighestVersionInfo?.highestVersion,
        allVersions: npmhighestVersionInfo?.allVersions,
      }),
      highestPublishedVersion: npmhighestVersionInfo && {
        version: npmhighestVersionInfo?.highestVersion,
      },
    }
  } else {
    return {
      targetType: TargetType.npm,
      needPublish: {
        skip: {
          reason: `this package with the same content was already published as npm package with version: ${publishedVersion}`,
        },
      },
      highestPublishedVersion: npmhighestVersionInfo && {
        version: npmhighestVersionInfo?.highestVersion,
      },
    }
  }
}

async function buildDockerTarget({
  packageJson,
  dockerOrganizationName,
  dockerRegistry,
  packageHash,
  packagePath,
  cache,
}: {
  packageJson: IPackageJson
  dockerRegistry: ServerInfo
  dockerOrganizationName: string
  packageHash: string
  packagePath: string
  cache: Cache
}): Promise<TargetInfo<TargetType.docker>> {
  if (!packageJson.name) {
    throw new Error(`package.json of: ${packagePath} must have a name property.`)
  }
  if (!packageJson.version) {
    throw new Error(`package.json of: ${packagePath} must have a version property.`)
  }
  const publishedTag = await cache.publish.docker.isPublished(packageJson.name as string, packageHash)
  const needPublish = !publishedTag
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
        highestPublishedVersion: dockerLatestTagInfo?.latestTag,
        allVersions: dockerLatestTagInfo?.allTags,
      }),
      highestPublishedVersion: dockerLatestTagInfo && {
        version: dockerLatestTagInfo.latestTag,
        hash: dockerLatestTagInfo.latestHash,
      },
    }
  } else {
    return {
      targetType: TargetType.docker,
      needPublish: {
        skip: {
          reason: `this package with the same content was already published as docker package with tag: ${publishedTag}`,
        },
      },
      highestPublishedVersion: dockerLatestTagInfo && {
        version: dockerLatestTagInfo.latestTag,
        hash: dockerLatestTagInfo.latestHash,
      },
    }
  }
}

export async function getPackageTargetType(
  packagePath: string,
  packageJson: IPackageJson,
): Promise<TargetType | undefined> {
  const isNpm = !packageJson.private
  // @ts-ignore
  const isDocker: boolean = await fs.exists(path.join(packagePath, 'Dockerfile'))

  if (isNpm) {
    return TargetType.npm
  } else {
    if (isDocker) {
      return TargetType.docker
    }
  }
}

export async function getPackageInfo({
  dockerOrganizationName,
  packageHash,
  packagePath,
  relativePackagePath,
  cache,
  dockerRegistry,
  npmRegistry,
  targetType,
}: {
  relativePackagePath: string
  packagePath: string
  packageHash: string
  targetType: TargetType
  npmRegistry: ServerInfo
  dockerRegistry: ServerInfo
  dockerOrganizationName: string
  cache: Cache
}): Promise<PackageInfo> {
  const packageJson: IPackageJson = await fs.readJson(path.join(packagePath, 'package.json'))

  return {
    relativePackagePath,
    packagePath,
    packageJson,
    packageHash,
    target:
      targetType === TargetType.npm
        ? await buildNpmTarget({
            packageHash,
            packagePath,
            cache,
            npmRegistry,
            packageJson,
          })
        : targetType === TargetType.docker
        ? await buildDockerTarget({
            packageHash,
            packagePath,
            cache,
            dockerOrganizationName,
            dockerRegistry,
            packageJson,
          })
        : undefined,
  }
}
