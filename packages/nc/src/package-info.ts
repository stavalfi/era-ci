import fs from 'fs-extra'
import { IPackageJson } from 'package-json-type'
import path from 'path'
import { getDockerImageLabelsAndTags } from './docker-utils'
import { getNpmhighestVersionInfo } from './npm-utils'
import { Artifact, ServerInfo, TargetsInfo, TargetsPublishAuth, TargetToPublish, TargetType } from './types'
import { calculateNewVersion } from './versions'

async function buildNpmTarget({
  packageJson,
  npmRegistry,
  packagePath,
  repoPath,
}: {
  packageJson: IPackageJson
  npmRegistry: ServerInfo
  packagePath: string
  repoPath: string
}): Promise<TargetToPublish<TargetType.npm>> {
  if (!packageJson.name) {
    throw new Error(`package.json of: ${packagePath} must have a name property.`)
  }
  if (!packageJson.version) {
    throw new Error(`package.json of: ${packagePath} must have a version property.`)
  }
  const npmhighestVersionInfo = await getNpmhighestVersionInfo(packageJson.name, npmRegistry, repoPath)
  return {
    targetType: TargetType.npm,
    newVersionIfPublish: calculateNewVersion({
      packagePath,
      packageJsonVersion: packageJson.version,
      highestPublishedVersion: npmhighestVersionInfo?.highestVersion,
      allVersions: npmhighestVersionInfo?.allVersions,
    }),
  }
}

async function buildDockerTarget({
  packageJson,
  dockerOrganizationName,
  dockerRegistry,
  packagePath,
  publishAuth,
  repoPath,
}: {
  packageJson: IPackageJson
  dockerRegistry: ServerInfo
  dockerOrganizationName: string
  packagePath: string
  publishAuth: TargetsPublishAuth[TargetType.docker]
  repoPath: string
}): Promise<TargetToPublish<TargetType.docker>> {
  if (!packageJson.name) {
    throw new Error(`package.json of: ${packagePath} must have a name property.`)
  }
  if (!packageJson.version) {
    throw new Error(`package.json of: ${packagePath} must have a version property.`)
  }

  const dockerLatestTagInfo = await getDockerImageLabelsAndTags({
    dockerRegistry,
    dockerOrganizationName,
    packageJsonName: packageJson.name,
    publishAuth,
    repoPath,
  })

  return {
    targetType: TargetType.docker,
    newVersionIfPublish: calculateNewVersion({
      packagePath,
      packageJsonVersion: packageJson.version,
      highestPublishedVersion: dockerLatestTagInfo?.latestTag,
      allVersions: dockerLatestTagInfo?.allTags,
    }),
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
  targetType?: TargetType
  targetsInfo?: TargetsInfo<DeploymentClient>
  repoPath: string
}

export async function getPackageInfo<DeploymentClient>({
  packageHash,
  packagePath,
  packageJson,
  relativePackagePath,
  targetType,
  targetsInfo,
  repoPath,
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
      if (targetsInfo?.npm) {
        return {
          ...base,
          publishInfo: await buildNpmTarget({
            packagePath,
            npmRegistry: targetsInfo.npm.registry,
            packageJson,
            repoPath,
          }),
        }
      } else {
        return base
      }
    case TargetType.docker:
      if (targetsInfo?.docker) {
        return {
          ...base,
          publishInfo: await buildDockerTarget({
            packagePath,
            dockerOrganizationName: targetsInfo.docker.dockerOrganizationName,
            dockerRegistry: targetsInfo.docker.registry,
            packageJson,
            publishAuth: targetsInfo.docker.publishAuth,
            repoPath,
          }),
        }
      } else {
        return base
      }
  }
}
