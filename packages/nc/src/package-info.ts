import fs from 'fs-extra'
import { IPackageJson } from 'package-json-type'
import path from 'path'
import { getDockerImageLabelsAndTags } from './docker-utils'
import { getNpmhighestVersionInfo } from './npm-utils'
import { Artifact, Cache, PublishCache, ServerInfo, TargetType, TargetToPublish, TargetsInfo } from './types'
import { calculateNewVersion } from './versions'

async function buildNpmTarget({
  packageJson,
  npmRegistry,
  packageHash,
  packagePath,
  publishCache,
}: {
  packageJson: IPackageJson
  npmRegistry: ServerInfo
  packageHash: string
  packagePath: string
  publishCache: PublishCache
}): Promise<TargetToPublish<TargetType.npm>> {
  if (!packageJson.name) {
    throw new Error(`package.json of: ${packagePath} must have a name property.`)
  }
  if (!packageJson.version) {
    throw new Error(`package.json of: ${packagePath} must have a version property.`)
  }
  const publishedVersion = await publishCache.isPublished(packageJson.name as string, packageHash)
  const npmhighestVersionInfo = await getNpmhighestVersionInfo(packageJson.name, npmRegistry)
  if (!publishedVersion) {
    return {
      targetType: TargetType.npm,
      needPublish: true,
      newVersion: calculateNewVersion({
        packagePath,
        packageJsonVersion: packageJson.version,
        highestPublishedVersion: npmhighestVersionInfo?.highestVersion,
        allVersions: npmhighestVersionInfo?.allVersions,
      }),
    }
  } else {
    return {
      targetType: TargetType.npm,
      needPublish: {
        alreadyPublishedAsVersion: publishedVersion,
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
  publishCache,
}: {
  packageJson: IPackageJson
  dockerRegistry: ServerInfo
  dockerOrganizationName: string
  packageHash: string
  packagePath: string
  publishCache: PublishCache
}): Promise<TargetToPublish<TargetType.docker>> {
  if (!packageJson.name) {
    throw new Error(`package.json of: ${packagePath} must have a name property.`)
  }
  if (!packageJson.version) {
    throw new Error(`package.json of: ${packagePath} must have a version property.`)
  }
  const publishedTag = await publishCache.isPublished(packageJson.name as string, packageHash)
  const dockerLatestTagInfo = await getDockerImageLabelsAndTags({
    dockerRegistry,
    dockerOrganizationName,
    packageJsonName: packageJson.name,
  })

  if (!publishedTag) {
    return {
      targetType: TargetType.docker,
      needPublish: true,
      newVersion: calculateNewVersion({
        packagePath,
        packageJsonVersion: packageJson.version,
        highestPublishedVersion: dockerLatestTagInfo?.latestTag,
        allVersions: dockerLatestTagInfo?.allTags,
      }),
    }
  } else {
    return {
      targetType: TargetType.docker,
      needPublish: {
        alreadyPublishedAsVersion: publishedTag,
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

  if (isDocker) {
    return TargetType.docker
  }
  if (isNpm) {
    return TargetType.npm
  }
}

type GetPackageInfoOptions<DeploymentClient> = {
  relativePackagePath: string
  packagePath: string
  packageHash: string
  packageJson: IPackageJson
  publishCache: Cache['publish']
  targetType?: TargetType
  targetsInfo: TargetsInfo<DeploymentClient>
}

export async function getPackageInfo<DeploymentClient>({
  packageHash,
  packagePath,
  packageJson,
  relativePackagePath,
  publishCache,
  targetType,
  targetsInfo,
}: GetPackageInfoOptions<DeploymentClient>): Promise<Artifact> {
  const base = {
    relativePackagePath,
    packagePath,
    packageJson,
    packageHash,
    targetType,
  }
  if (!targetType) {
    return base
  }
  switch (targetType) {
    case TargetType.npm:
      if (targetsInfo.npm) {
        return {
          ...base,
          publishInfo: await buildNpmTarget({
            packageHash,
            packagePath,
            publishCache: publishCache.npm!,
            npmRegistry: targetsInfo.npm.registry,
            packageJson,
          }),
        }
      } else {
        return base
      }
    case TargetType.docker:
      if (targetsInfo.docker) {
        return {
          ...base,
          publishInfo: await buildDockerTarget({
            packageHash,
            packagePath,
            publishCache: publishCache.docker!,
            dockerOrganizationName: targetsInfo.docker.dockerOrganizationName,
            dockerRegistry: targetsInfo.docker.registry,
            packageJson,
          }),
        }
      } else {
        return base
      }
  }
}
