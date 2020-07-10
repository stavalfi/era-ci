import fse from 'fs-extra'
import { IPackageJson } from 'package-json-type'
import path from 'path'
import { PackageName, TargetType } from './types'
import _ from 'lodash'

async function validatePackage(
  packagePath: string,
  packagesTargetType: Map<
    PackageName,
    {
      version?: string
      targetType?: TargetType
    }
  >,
): Promise<string[]> {
  const packageJson: IPackageJson = await fse.readJson(path.join(packagePath, 'package.json'))

  const hasVersion = () => {
    if (!packageJson.version) {
      return `package.json of: ${packagePath} must have a version property.`
    } else {
      return ''
    }
  }

  if (!packageJson.name) {
    throw new Error(`package.json of: ${packagePath} must have a name property.`)
  }

  enum Validation {
    noPrivateNpm = 'noPrivateNpm',
    noDocker = 'noDocker',
  }

  const validationsBuilder = (
    dep: string,
    targetType: TargetType | undefined,
    version: string,
  ): { [validation in Validation]: string | undefined | false } => ({
    noPrivateNpm:
      !targetType && `this package can't depend on private npm package inside the monorepo: ${dep}@${version}`,
    noDocker:
      targetType === TargetType.docker &&
      `this package can't depend on docker target inside the monorepo: ${dep}@${version}`,
  })

  const validateDependencies = (...validations: Validation[]): string[] => {
    return Object.entries({
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
      ...packageJson.peerDependencies,
    })
      .flatMap(([dep, version]) => {
        const result = packagesTargetType.get(dep)
        if (result?.version === version) {
          const allValidations = validationsBuilder(dep, result.targetType, result.version)
          return validations.filter(validation => allValidations[validation])
        } else {
          return []
        }
      })
      .filter(Boolean)
  }

  switch (packagesTargetType.get(packageJson.name)?.targetType) {
    case TargetType.docker:
    case TargetType.npm: {
      return [hasVersion(), ...validateDependencies(Validation.noDocker, Validation.noPrivateNpm)].filter(Boolean)
    }
    // case TargetType.docker: {
    //   hasVersion()
    //   return validateDependencies(Validation.noDocker, Validation.noPrivateNpm)
    //   if (problems.length > 0) {
    //     throw new Error(`package: ${packageJson.name} is target: ${TargetType.docker}. it has problems: ${problems}`)
    //   }
    //   break
    // }
    default: {
      return [hasVersion()].filter(Boolean)
    }
  }
}

export async function validatePackages(
  packagesTargets: {
    packagePath: string
    targetType?: TargetType
  }[],
) {
  const packagePathToTargetAndVersion = new Map(
    await Promise.all(
      packagesTargets.map<Promise<[string, { version?: string; targetType?: TargetType }]>>(
        async ({ packagePath, targetType }) => [
          packagePath,
          {
            version: ((await fse.readJSON(path.join(packagePath, 'package.json'))) as IPackageJson).version,
            targetType,
          },
        ],
      ),
    ),
  )

  const problems = _.flatten(
    await Promise.all(
      packagesTargets.map(async ({ packagePath }) => validatePackage(packagePath, packagePathToTargetAndVersion)),
    ),
  )

  if (problems.length > 0) {
    throw new Error(`problems:\n ${problems.join('\n')}`)
  }
}
