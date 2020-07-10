import chance from 'chance'
import execa from 'execa'
import fse from 'fs-extra'
import { IPackageJson } from 'package-json-type'
import path from 'path'
import { buildFullDockerImageName, npmRegistryLogin } from '../../src/ci-logic'
import { ServerInfo } from '../../src/types'
import { latestNpmPackageDistTags, latestNpmPackageVersion } from './seach-targets'
import { CreateAndManageRepo, MinimalNpmPackage, TargetType, ToActualName } from './types'
import { getPackagePath, getPackages } from './utils'

export async function commitAllAndPushChanges(repoPath: string, gitRepoAddress: string) {
  await execa.command('git add --all', { cwd: repoPath })
  await execa.command('git commit -m init', { cwd: repoPath })
  await execa.command(`git push ${gitRepoAddress}`, { cwd: repoPath })
}

export async function removeAllNpmHashTags({
  npmRegistry,
  npmRegistryEmail,
  npmRegistryToken,
  npmRegistryUsername,
  packageName,
  repoPath,
  toActualName,
}: {
  packageName: string
  npmRegistry: ServerInfo
  npmRegistryUsername: string
  npmRegistryToken: string
  npmRegistryEmail: string
  repoPath: string
  toActualName: ToActualName
}): Promise<void> {
  const npmRegistryAddress = `${npmRegistry.protocol}://${npmRegistry.host}:${npmRegistry.port}`

  const packagePath = await getPackagePath(repoPath, toActualName)(packageName)
  await npmRegistryLogin({
    npmRegistry,
    npmRegistryEmail,
    npmRegistryToken,
    npmRegistryUsername,
  })
  const latestVersion = await latestNpmPackageVersion(toActualName(packageName), npmRegistry)
  const distTags = await latestNpmPackageDistTags(toActualName(packageName), npmRegistry)

  await Promise.all(
    Object.keys(distTags || {})
      .filter(key => key.length === 56)
      .map(key =>
        execa.command(
          `npm dist-tag rm ${toActualName(packageName)}@${latestVersion} ${key} --registry ${npmRegistryAddress}`,
          {
            stdio: 'pipe',
            cwd: packagePath,
          },
        ),
      ),
  )
}

export async function publishNpmPackageWithoutCi({
  npmRegistry,
  npmRegistryEmail,
  npmRegistryToken,
  npmRegistryUsername,
  packageName,
  repoPath,
  toActualName,
}: {
  packageName: string
  npmRegistry: ServerInfo
  npmRegistryUsername: string
  npmRegistryToken: string
  npmRegistryEmail: string
  repoPath: string
  toActualName: ToActualName
}): Promise<void> {
  const packagePath = await getPackagePath(repoPath, toActualName)(packageName)
  await npmRegistryLogin({
    npmRegistry,
    npmRegistryEmail,
    npmRegistryToken,
    npmRegistryUsername,
  })
  const npmRegistryAddress = `${npmRegistry.protocol}://${npmRegistry.host}:${npmRegistry.port}`
  await execa.command(`npm publish --registry ${npmRegistryAddress}`, {
    stdio: 'pipe',
    cwd: packagePath,
  })
}

export async function publishDockerPackageWithoutCi({
  dockerOrganizationName,
  dockerRegistry,
  packageName,
  repoPath,
  toActualName,
  imageTag,
  labels,
}: {
  packageName: string
  dockerRegistry: ServerInfo
  dockerOrganizationName: string
  repoPath: string
  toActualName: ToActualName
  imageTag: string
  labels?: { 'latest-hash'?: string; 'latest-tag'?: string }
}): Promise<void> {
  const packagePath = await getPackagePath(repoPath, toActualName)(packageName)
  const fullImageNameNewVersion = buildFullDockerImageName({
    dockerOrganizationName,
    dockerRegistry,
    packageJsonName: toActualName(packageName),
    imageTag,
  })
  const labelsJoined =
    Object.entries(labels || {})
      .map(([key, value]) => `--label ${key}=${value}`)
      .join(' ') || ''

  await execa.command(`docker build ${labelsJoined} -f Dockerfile -t ${fullImageNameNewVersion} ${repoPath}`, {
    cwd: packagePath,
  })
  await execa.command(`docker push ${fullImageNameNewVersion}`)
}

export async function unpublishNpmPackage({
  npmRegistry,
  npmRegistryEmail,
  npmRegistryToken,
  npmRegistryUsername,
  packageName,
  toActualName,
  versionToUnpublish,
}: {
  packageName: string
  npmRegistry: ServerInfo
  npmRegistryUsername: string
  npmRegistryToken: string
  npmRegistryEmail: string
  toActualName: ToActualName
  versionToUnpublish: string
}): Promise<void> {
  await npmRegistryLogin({
    npmRegistry,
    npmRegistryEmail,
    npmRegistryToken,
    npmRegistryUsername,
  })
  const npmRegistryAddress = `${npmRegistry.protocol}://${npmRegistry.host}:${npmRegistry.port}`
  await execa.command(
    `npm unpublish ${toActualName(packageName)}@${versionToUnpublish} --registry ${npmRegistryAddress}`,
  )
}

export const addRandomFileToPackage = ({
  repoPath,
  toActualName,
  gitRepoAddress,
}: {
  toActualName: ToActualName
  repoPath: string
  gitRepoAddress: string
}) => async (packageName: string): Promise<string> => {
  const packagesPath = await getPackages(repoPath)
  const packagePath = packagesPath.find(path => path.endsWith(toActualName(packageName)))
  if (!packagePath) {
    throw new Error(`package "${packageName}" not found in [${packagesPath.join(', ')}]`)
  }
  const filePath = path.join(packagePath, `random-file-${chance().hash()}`)
  await fse.writeFile(filePath, '')

  await commitAllAndPushChanges(repoPath, gitRepoAddress)
  return filePath
}

export const runDockerImage = async (fullDockerImageName: string): Promise<execa.ExecaChildProcess> => {
  const containerName = `container-${chance().hash()}`

  return execa.command(`docker run --name ${containerName} ${fullDockerImageName}`).finally(async () => {
    await execa.command(`docker rm ${containerName}`).catch(() => {
      /**/
    })
  })
}

export const installAndRunNpmDependency = async ({
  toActualName,
  createRepo,
  npmRegistry,
  dependencyName,
}: {
  toActualName: ToActualName
  npmRegistry: ServerInfo
  createRepo: CreateAndManageRepo
  dependencyName: string
}): Promise<execa.ExecaChildProcess<string>> => {
  const { getPackagePath } = await createRepo({
    packages: [
      {
        name: 'b',
        version: '2.0.0',
        targetType: TargetType.none,
        dependencies: {
          [toActualName(dependencyName)]: `${npmRegistry.protocol}://${npmRegistry.host}:${
            npmRegistry.port
          }/${toActualName(dependencyName)}/-/${toActualName(dependencyName)}-1.0.0.tgz`,
        },
        'index.js': `require("${toActualName(dependencyName)}")`,
      },
    ],
  })
  return execa.node(path.join(await getPackagePath('b'), 'index.js'))
}

export const addRandomFileToRoot = async ({
  repoPath,
  gitRepoAddress,
}: {
  repoPath: string
  gitRepoAddress: string
}): Promise<string> => {
  const filePath = path.join(repoPath, `random-file-${chance().hash()}`)
  await fse.writeFile(filePath, '')

  await commitAllAndPushChanges(repoPath, gitRepoAddress)
  return filePath
}

export const modifyPackageJson = async ({
  packageName,
  repoPath,
  gitRepoAddress,
  modification,
  toActualName,
}: {
  packageName: string
  repoPath: string
  gitRepoAddress: string
  toActualName: ToActualName
  modification: (packageJson: IPackageJson) => IPackageJson
}): Promise<void> => {
  const packagePath = await getPackagePath(repoPath, toActualName)(packageName)
  const before: IPackageJson = await fse.readJson(path.join(packagePath, 'package.json'))
  const after = modification(before)
  await fse.remove(path.join(packagePath, 'package.json'))
  await fse.writeJSON(path.join(packagePath, 'package.json'), after)
  await commitAllAndPushChanges(repoPath, gitRepoAddress)
}

export const renamePackageFolder = async ({
  packageName,
  repoPath,
  gitRepoAddress,
  toActualName,
}: {
  packageName: string
  repoPath: string
  gitRepoAddress: string
  toActualName: ToActualName
}): Promise<string> => {
  const packagePath = await getPackagePath(repoPath, toActualName)(packageName)
  const newPackagePath = path.join(
    packagePath,
    '..',
    chance()
      .hash()
      .slice(0, 8),
  )
  await fse.rename(packagePath, newPackagePath)
  await commitAllAndPushChanges(repoPath, gitRepoAddress)
  return newPackagePath
}

export const movePackageFolder = async ({
  packageName,
  repoPath,
  gitRepoAddress,
  toActualName,
  newParentDirPath,
}: {
  packageName: string
  repoPath: string
  gitRepoAddress: string
  toActualName: ToActualName
  newParentDirPath: string
}): Promise<string> => {
  const packagePath = await getPackagePath(repoPath, toActualName)(packageName)
  const newPackagePath = path.join(newParentDirPath, path.basename(packagePath))
  await fse.move(packagePath, newPackagePath)
  await commitAllAndPushChanges(repoPath, gitRepoAddress)
  return newPackagePath
}

export const createNewPackage = async ({
  repoPath,
  gitRepoAddress,
  toActualName,
  newNpmPackage,
  createUnderFolderPath,
}: {
  repoPath: string
  gitRepoAddress: string
  toActualName: ToActualName
  newNpmPackage: MinimalNpmPackage
  createUnderFolderPath: string
}): Promise<void> => {
  await fse.writeJSON(path.join(createUnderFolderPath, 'package.json'), {
    name: toActualName(newNpmPackage.name),
    version: newNpmPackage.version,
  })
  await execa.command(`yarn install`, { cwd: repoPath })
  await commitAllAndPushChanges(repoPath, gitRepoAddress)
}

export const deletePackage = async ({
  repoPath,
  gitRepoAddress,
  toActualName,
  packageName,
}: {
  repoPath: string
  gitRepoAddress: string
  toActualName: ToActualName
  packageName: string
}): Promise<void> => {
  const packagePath = await getPackagePath(repoPath, toActualName)(packageName)
  await fse.remove(packagePath)
  await execa.command(`yarn install`, { cwd: repoPath })
  await commitAllAndPushChanges(repoPath, gitRepoAddress)
}