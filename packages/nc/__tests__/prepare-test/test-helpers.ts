import chance from 'chance'
import execa from 'execa'
import fse from 'fs-extra'
import Redis from 'ioredis'
import { IPackageJson } from 'package-json-type'
import path from 'path'
import { buildFullDockerImageName, npmRegistryLogin } from '../../src'
import { CacheTypes, ServerInfo } from '../../src/types'
import { CreateAndManageRepo, MinimalNpmPackage, TargetType, ToActualName } from './types'
import { getPackagePath, getPackages, ignore } from './utils'
import { createFile } from 'create-folder-structure'

export async function manageStepResult() {
  const assertionFilePath = await createFile()

  const writeToFile = (expectedContentInLog: string) => fse.writeFile(assertionFilePath, expectedContentInLog)

  const content = `content-${chance().hash()}`

  return {
    stepScript: `node ${assertionFilePath}`,
    expectedContentInLog: () => content,
    makeStepPass: () => writeToFile(`console.log("passed-${content}")`),
    makeStepFail: () => writeToFile(`throw new Error("failed-${content}")`),
  }
}

export async function commitAllAndPushChanges(repoPath: string, gitRepoAddress: string) {
  await execa.command('git add --all', { cwd: repoPath, stdio: 'pipe' })
  await execa.command('git commit -m init', { cwd: repoPath, stdio: 'pipe' }).catch(ignore) // incase nothing was changed from the last commit, git will throw error
  await execa.command(`git push ${gitRepoAddress}`, { cwd: repoPath, stdio: 'pipe' })
}

export async function removeAllNpmHashTags({
  packageName,
  redisServer,
}: {
  packageName: string
  redisServer: ServerInfo
}): Promise<void> {
  const redisClient = new Redis({
    host: redisServer.host,
    port: redisServer.port,
  })
  const keys = await redisClient.keys(`${CacheTypes.publish}-${packageName}-${TargetType.npm}-*`)
  await redisClient.del(...keys)
  await redisClient.quit()
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
    silent: true,
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
    stdio: 'pipe',
    cwd: packagePath,
  })
  await execa.command(`docker push ${fullImageNameNewVersion}`, { stdio: 'pipe' })
  await execa.command(`docker rmi ${fullImageNameNewVersion}`, { stdio: 'pipe' })
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
    silent: true,
  })
  const npmRegistryAddress = `${npmRegistry.protocol}://${npmRegistry.host}:${npmRegistry.port}`
  await execa.command(
    `npm unpublish ${toActualName(packageName)}@${versionToUnpublish} --registry ${npmRegistryAddress}`,
    { stdio: 'pipe' },
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
  const packagePath = packagesPath.find((path) => path.endsWith(toActualName(packageName)))
  if (!packagePath) {
    throw new Error(`package "${packageName}" not found in [${packagesPath.join(', ')}]`)
  }
  const filePath = path.join(packagePath, `random-file-${chance().hash()}`)
  await fse.writeFile(filePath, '')

  await commitAllAndPushChanges(repoPath, gitRepoAddress)
  return filePath
}

export const runDockerImage = async (fullDockerImageName: string): Promise<execa.ExecaChildProcess> => {
  return execa.command(`docker run --rm ${fullDockerImageName}`, { stdio: 'pipe' })
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
        dependencies: {
          [toActualName(dependencyName)]: `${npmRegistry.protocol}://${npmRegistry.host}:${
            npmRegistry.port
          }/${toActualName(dependencyName)}/-/${toActualName(dependencyName)}-1.0.0.tgz`,
        },
        'index.js': `require("${toActualName(dependencyName)}")`,
      },
    ],
  })
  return execa.node(path.join(await getPackagePath('b'), 'index.js'), { stdio: 'pipe' })
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
  await fse.writeFile(path.join(packagePath, 'package.json'), JSON.stringify(after, null, 2))
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
  const newPackagePath = path.join(packagePath, '..', chance().hash().slice(0, 8))
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
  await fse.writeFile(
    path.join(createUnderFolderPath, 'package.json'),
    JSON.stringify(
      {
        name: toActualName(newNpmPackage.name),
        version: newNpmPackage.version,
      },
      null,
      2,
    ),
  )
  await execa.command(`yarn install`, { cwd: repoPath, stdio: 'pipe' })
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
  await execa.command(`yarn install`, { cwd: repoPath, stdio: 'pipe' })
  await commitAllAndPushChanges(repoPath, gitRepoAddress)
}
