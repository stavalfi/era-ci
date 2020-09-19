import path from 'path'
import { Artifact } from '../../types'
import fse from 'fs-extra'

export const setPackageVersion = async ({ toVersion, artifact }: { toVersion: string; artifact: Artifact }) => {
  const packageJsonPath = path.join(artifact.packagePath, 'package.json')
  const fromVersion = artifact.packageJson.version
  if (!fromVersion) {
    throw new Error(
      `package.json: ${packageJsonPath} must have a version property. set it up to any valid version you want. for example: "1.0.0"`,
    )
  }
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
