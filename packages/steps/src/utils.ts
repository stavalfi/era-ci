import { Artifact, PackageJson } from '@tahini/utils'
import fse from 'fs-extra'
import path from 'path'
import semver from 'semver'

export const setPackageVersion = async ({
  toVersion,
  artifact,
  fromVersion,
}: {
  fromVersion: string
  toVersion: string
  artifact: Artifact
}): Promise<void> => {
  const packageJsonPath = path.join(artifact.packagePath, 'package.json')
  const packageJsonAsString = await fse.readFile(packageJsonPath, 'utf-8')
  const from = `"version": "${fromVersion}"`
  const to = `"version": "${toVersion}"`
  if (packageJsonAsString.includes(from)) {
    const updatedPackageJson = packageJsonAsString.replace(from, to)
    await fse.writeFile(packageJsonPath, updatedPackageJson, 'utf-8')
  } else {
    throw new Error(
      `could not find the following substring in package.json: '${from}'. is there any missing/extra spaces? package.json as string: ${packageJsonAsString}`,
    )
  }
}

export enum TargetType {
  docker = 'docker',
  npm = 'npm',
}

export function calculateNewVersion({
  packagePath,
  packageJsonVersion,
  allVersions,
  highestPublishedVersion,
}: {
  packagePath: string
  packageJsonVersion: string
  highestPublishedVersion?: string
  allVersions?: Array<string>
}): string {
  if (!semver.valid(packageJsonVersion)) {
    throw new Error(`version packgeJson in ${packagePath} is invalid: ${packageJsonVersion}`)
  }
  const allValidVersions = allVersions?.filter(version => semver.valid(version))

  if (!allValidVersions?.length) {
    // this is immutable in each registry so if this is not defined or empty, it means that we never published before or there was unpublish of all the versions.
    return packageJsonVersion
  }

  const incVersion = (version: string) => {
    if (!semver.valid(version)) {
      throw new Error(`version is invalid: ${version} in ${packagePath}`)
    }
    const newVersion = semver.inc(version, 'patch')
    if (!newVersion) {
      throw new Error(`could not path-increment version: ${version} in ${packagePath}`)
    }
    return newVersion
  }

  if (!highestPublishedVersion) {
    // this is mutable in each registry so if we have versions but this is false, it means that:
    // a. this is the first run of the ci on a target that was already pbulished.
    // b. or, less likely, someone mutated one of the labels that this ci is modifying in every run :(

    if (allValidVersions.includes(packageJsonVersion)) {
      return incVersion(packageJsonVersion)
    } else {
      return packageJsonVersion
    }
  } else {
    if (allValidVersions.includes(highestPublishedVersion)) {
      const maxVersion = semver.gt(packageJsonVersion, highestPublishedVersion)
        ? packageJsonVersion
        : highestPublishedVersion

      if (allVersions?.includes(maxVersion)) {
        return incVersion(maxVersion)
      } else {
        return maxVersion
      }
    } else {
      const sorted = semver.sort(allValidVersions)

      return incVersion(sorted[sorted.length - 1])
    }
  }
}

export async function getPackageTargetType(
  packagePath: string,
  packageJson: PackageJson,
): Promise<TargetType | undefined> {
  const isNpm = !packageJson.private
  // @ts-ignore
  const isDocker: boolean = await fse.exists(path.join(packagePath, 'Dockerfile'))

  if (isDocker) {
    return TargetType.docker
  }
  if (isNpm) {
    return TargetType.npm
  }
}
