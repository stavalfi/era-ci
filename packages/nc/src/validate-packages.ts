import _ from 'lodash'
import { IDependencyMap, IPackageJson } from 'package-json-type'
import { version } from 'punycode'
import semver from 'semver'
import { PackageName, TargetType } from './types'

async function validatePackage(
  packageName: PackageName,
  packageNameToInfo: Map<
    PackageName,
    {
      targetType?: TargetType | undefined
      packageJson: IPackageJson
      packagePath: string
    }
  >,
): Promise<string[]> {
  const currentPackageInfo = packageNameToInfo.get(packageName)

  if (!currentPackageInfo) {
    throw new Error(`bug: trying to validate a package in monorepo that doesn't exist in the monorepo: ${packageName}`)
  }

  const problems: string[] = []

  const deps: IDependencyMap = {
    ...currentPackageInfo.packageJson.dependencies,
    ...currentPackageInfo.packageJson.devDependencies,
    ...currentPackageInfo.packageJson.peerDependencies,
  }

  if (Boolean(currentPackageInfo.targetType) && !version) {
    problems.push(`the package "${packageName}" must have version property in it's package.json`)
  }

  const depsProblems = Object.entries(deps).flatMap(([dep, versionRange]) => {
    const depInMonoRepo = packageNameToInfo.get(dep)
    if (!depInMonoRepo) {
      return []
    }
    const depVersion = depInMonoRepo.packageJson.version

    const depProblems: string[] = []

    if (depVersion) {
      const isInRange = semver.satisfies(depVersion, versionRange)
      if (isInRange) {
        if (currentPackageInfo.targetType === TargetType.npm && !depInMonoRepo.targetType) {
          depProblems.push(
            `the package "${packageName}" can't depend on dependency: "${dep}" in version "${versionRange}" becuase this version represents a private-npm-package`,
          )
        }

        if (depInMonoRepo.targetType === TargetType.docker) {
          depProblems.push(
            `the package "${packageName}" can't depend on dependency: "${dep}" in version "${versionRange}" becuase this version represents a docker-package`,
          )
        }
      }
    }
    return depProblems
  })

  problems.push(...depsProblems)

  return problems
}

export async function validatePackages(
  artifacts: {
    packagePath: string
    targetType?: TargetType
    packageJson: IPackageJson
  }[],
) {
  const problems: string[] = []

  const missingNamesProblems = artifacts
    .filter(artifact => !artifact.packageJson.name)
    .map(artifact => `package: ${artifact.packagePath} must have a name property in the package.json`)

  problems.push(...missingNamesProblems)

  if (missingNamesProblems.length > 0) {
    throw new Error(`problems:\n ${missingNamesProblems.join('\n')}`)
  } else {
    const packageNameToInfo = new Map(
      artifacts.map<[string, { targetType?: TargetType; packageJson: IPackageJson; packagePath: string }]>(
        ({ packageJson, targetType, packagePath }) => {
          return [
            packageJson.name as string,
            {
              packageJson,
              targetType,
              packagePath,
            },
          ]
        },
      ),
    )

    const addtionalProblems = _.flatten(
      await Promise.all(
        artifacts.map(async ({ packageJson }) => validatePackage(packageJson.name as string, packageNameToInfo)),
      ),
    )

    problems.push(...addtionalProblems)
  }

  if (problems.length > 0) {
    throw new Error(`problems:\n ${problems.join('\n')}`)
  }
}
