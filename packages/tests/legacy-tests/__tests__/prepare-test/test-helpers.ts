import { Log } from '@era-ci/core'
import { buildFullDockerImageName, getPackages } from '@era-ci/utils'
import { createFile, createFolder } from '@stavalfi/create-folder-structure'
import chance from 'chance'
import execa from 'execa'
import fs from 'fs'
import Redis from 'ioredis'
import { IPackageJson } from 'package-json-type'
import path from 'path'
import { CreateAndManageRepo, MinimalNpmPackage, ToActualName } from './types'
import { getPackagePath, ignore } from './utils'

export async function manageStepResult() {
  const assertionFilePath = await createFile()

  const writeToFile = (expectedContentInLog: string) =>
    fs.promises.writeFile(assertionFilePath, expectedContentInLog, 'utf-8')

  const content = `content-${chance().hash().slice(0, 8)}`

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
  redisServerUrl,
}: {
  packageName: string
  redisServerUrl: string
}): Promise<void> {
  const redisConnection = new Redis(redisServerUrl, {
    showFriendlyErrorStack: true,
  })

  const keys = await redisConnection.keys(`npm-version-of-${packageName}-*`)
  if (keys.length === 0) {
    throw new Error(
      `looks like we could not find any key that represent the new-version of an artifact. \
maybe the key-schema changed in the production code. anyways, \
this test is useless until update the key-schema in this test-function`,
    )
  }
  await redisConnection.del(...keys)
  redisConnection.disconnect()
}

export async function publishNpmPackageWithoutCi({
  npmRegistry,
  packageName,
  repoPath,
  toActualName,
  log,
  processEnv,
}: {
  packageName: string
  npmRegistry: {
    address: string
    auth: {
      username: string
      password: string
      email: string
    }
  }
  toActualName: ToActualName
  repoPath: string
  log: Log
  processEnv: NodeJS.ProcessEnv
}): Promise<void> {
  const packagePath = await getPackagePath(repoPath, toActualName, processEnv)(packageName)
  await execa.command(`npm publish --registry ${npmRegistry.address}`, {
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
  processEnv,
}: {
  packageName: string
  dockerRegistry: string
  dockerOrganizationName: string
  repoPath: string
  toActualName: ToActualName
  imageTag: string
  labels?: { 'latest-hash'?: string; 'latest-tag'?: string }
  processEnv: NodeJS.ProcessEnv
}): Promise<void> {
  const packagePath = await getPackagePath(repoPath, toActualName, processEnv)(packageName)
  const fullImageNameNewVersion = buildFullDockerImageName({
    dockerOrganizationName,
    dockerRegistry,
    imageName: toActualName(packageName),
    imageTag,
  })
  const labelsJoined =
    Object.entries(labels || {})
      .map(([key, value]) => `--label ${key}=${value}`)
      .join(' ') || ''

  await execa.command(`docker build ${labelsJoined} -f Dockerfile -t ${fullImageNameNewVersion} ${repoPath}`, {
    stdio: 'pipe',
    cwd: packagePath,
    env: {
      DOCKER_BUILDKIT: '1',
    },
  })
  await execa.command(`docker push ${fullImageNameNewVersion}`, { stdio: 'pipe' })
  await execa.command(`docker rmi ${fullImageNameNewVersion}`, { stdio: 'pipe' })
}

export async function unpublishNpmPackage({
  npmRegistry,
  packageName,
  toActualName,
  versionToUnpublish,
  repoPath,
  log,
  processEnv,
}: {
  packageName: string
  npmRegistry: {
    address: string
    auth: {
      username: string
      password: string
      email: string
    }
  }
  toActualName: ToActualName
  versionToUnpublish: string
  repoPath: string
  log: Log
  processEnv: NodeJS.ProcessEnv
}): Promise<void> {
  await execa.command(
    `npm unpublish ${toActualName(packageName)}@${versionToUnpublish} --registry ${npmRegistry.address}`,
    {
      stdio: 'pipe',
    },
  )
}

export const addRandomFileToPackage = ({
  repoPath,
  toActualName,
  gitRepoAddress,
  processEnv,
}: {
  toActualName: ToActualName
  repoPath: string
  gitRepoAddress: string
  processEnv: NodeJS.ProcessEnv
}) => async (packageName: string): Promise<string> => {
  const packagesPath = await getPackages({ repoPath, processEnv }).then(r => Object.values(r).map(w => w.location))
  const packagePath = packagesPath.find(path => path.endsWith(toActualName(packageName)))
  if (!packagePath) {
    throw new Error(`package "${packageName}" not found in [${packagesPath.join(', ')}]`)
  }
  const filePath = path.join(packagePath, `random-file-${chance().hash().slice(0, 8)}`)
  await fs.promises.writeFile(filePath, '', 'utf-8')

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
  log,
  repoPath,
  processEnv,
}: {
  toActualName: ToActualName
  npmRegistry: {
    address: string
    auth: {
      username: string
      password: string
      email: string
    }
  }
  createRepo: CreateAndManageRepo
  dependencyName: string
  repoPath: string
  log: Log
  processEnv: NodeJS.ProcessEnv
}): Promise<execa.ExecaChildProcess<string>> => {
  const newRepoPath = await createFolder()
  await fs.promises.writeFile(path.join(newRepoPath, 'package.json'), JSON.stringify({ name: 'b' }), 'utf-8')
  // I can't find a way to install from private-registry in yarn2 :(
  await execa.command(`npm install ${toActualName(dependencyName)} --registry ${npmRegistry.address}`, {
    cwd: newRepoPath,
    stdio: 'pipe',
  })
  await fs.promises.writeFile(path.join(newRepoPath, 'index.js'), `require("${toActualName(dependencyName)}")`, 'utf-8')

  return execa.node(path.join(newRepoPath, 'index.js'), { stdio: 'pipe' })
}

export const addRandomFileToRoot = async ({
  repoPath,
  gitRepoAddress,
}: {
  repoPath: string
  gitRepoAddress: string
}): Promise<string> => {
  const filePath = path.join(repoPath, `random-file-${chance().hash().slice(0, 8)}`)
  await fs.promises.writeFile(filePath, '', 'utf-8')

  await commitAllAndPushChanges(repoPath, gitRepoAddress)
  return filePath
}

export const modifyPackageJson = async ({
  packageName,
  repoPath,
  gitRepoAddress,
  modification,
  toActualName,
  processEnv,
}: {
  packageName: string
  repoPath: string
  gitRepoAddress: string
  toActualName: ToActualName
  modification: (packageJson: IPackageJson) => IPackageJson
  processEnv: NodeJS.ProcessEnv
}): Promise<void> => {
  const packagePath = await getPackagePath(repoPath, toActualName, processEnv)(packageName)
  const before: IPackageJson = JSON.parse(await fs.promises.readFile(path.join(packagePath, 'package.json'), 'utf-8'))
  const after = modification(before)
  await fs.promises.unlink(path.join(packagePath, 'package.json'))
  await fs.promises.writeFile(path.join(packagePath, 'package.json'), `${JSON.stringify(after, null, 2)}`, 'utf-8')
  await commitAllAndPushChanges(repoPath, gitRepoAddress)
}

export const renamePackageFolder = async ({
  packageName,
  repoPath,
  gitRepoAddress,
  toActualName,
  processEnv,
}: {
  packageName: string
  repoPath: string
  gitRepoAddress: string
  toActualName: ToActualName
  processEnv: NodeJS.ProcessEnv
}): Promise<string> => {
  const packagePath = await getPackagePath(repoPath, toActualName, processEnv)(packageName)
  const newPackagePath = path.join(packagePath, '..', `${packageName}-rename-${chance().hash().slice(0, 8)}`)
  await fs.promises.rename(packagePath, newPackagePath)
  await commitAllAndPushChanges(repoPath, gitRepoAddress)
  return newPackagePath
}

export const movePackageFolder = async ({
  packageName,
  repoPath,
  gitRepoAddress,
  toActualName,
  newParentDirPath,
  processEnv,
}: {
  packageName: string
  repoPath: string
  gitRepoAddress: string
  toActualName: ToActualName
  newParentDirPath: string
  processEnv: NodeJS.ProcessEnv
}): Promise<string> => {
  const packagePath = await getPackagePath(repoPath, toActualName, processEnv)(packageName)
  const newPackagePath = path.join(newParentDirPath, path.basename(packagePath))
  await fs.promises.rename(packagePath, newPackagePath)
  await commitAllAndPushChanges(repoPath, gitRepoAddress)
  return newPackagePath
}

export const createNewPackage = async ({
  repoPath,
  gitRepoAddress,
  toActualName,
  newNpmPackage,
  createUnderFolderPath,
  processEnv,
  npmRegistryAddressToPublish,
}: {
  repoPath: string
  gitRepoAddress: string
  toActualName: ToActualName
  newNpmPackage: MinimalNpmPackage
  createUnderFolderPath: string
  processEnv: NodeJS.ProcessEnv
  npmRegistryAddressToPublish: string
}): Promise<void> => {
  await fs.promises.writeFile(
    path.join(createUnderFolderPath, 'package.json'),
    JSON.stringify(
      {
        name: toActualName(newNpmPackage.name),
        version: newNpmPackage.version,
        publishConfig: {
          access: 'public',
          registry: npmRegistryAddressToPublish,
        },
      },
      null,
      2,
    ),
    'utf-8',
  )

  await execa.command(`yarn install`, { cwd: repoPath, stdio: 'pipe' })
  await commitAllAndPushChanges(repoPath, gitRepoAddress)
}

export const deletePackage = async ({
  repoPath,
  gitRepoAddress,
  toActualName,
  packageName,
  log,
  npmRegistry,
  processEnv,
}: {
  repoPath: string
  gitRepoAddress: string
  toActualName: ToActualName
  packageName: string
  log: Log
  npmRegistry: {
    address: string
    auth: {
      username: string
      password: string
      email: string
    }
  }
  processEnv: NodeJS.ProcessEnv
}): Promise<void> => {
  const packagePath = await getPackagePath(repoPath, toActualName, processEnv)(packageName)
  await fs.promises.rm(packagePath, { recursive: true })
  await execa.command(`yarn install`, {
    cwd: repoPath,
    stdio: 'pipe',
  })
  await commitAllAndPushChanges(repoPath, gitRepoAddress)
}
