/// <reference path="../../../../../declarations.d.ts" />

import { createGitRepo, createTest } from '@era-ci/e2e-tests-infra'
import { buildFullDockerImageName, PackageManager } from '@era-ci/utils'
import chance from 'chance'
import execa from 'execa'
import {
  addRandomFileToPackage,
  addRandomFileToRoot,
  createNewPackage,
  deletePackage,
  installAndRunNpmDependency,
  modifyPackageJson,
  movePackageFolder,
  publishDockerPackageWithoutCi,
  publishNpmPackageWithoutCi,
  removeAllNpmHashTags,
  renamePackageFolder,
  unpublishNpmPackage,
} from './test-helpers'
import { CreateAndManageRepo, MinimalNpmPackage, NewEnv, RunCi } from './types'
import { getPackagePath, runCiUsingConfigFile } from './utils'

export const newEnv: NewEnv = () => {
  const testFuncs = createTest()

  const createAndManageRepo: CreateAndManageRepo = async (repo = {}) => {
    const resourcesNamesPostfix = chance().hash().slice(0, 8)

    const toActualName = (name: string) =>
      name.endsWith(`-${resourcesNamesPostfix}`) ? name : `${name}-${resourcesNamesPostfix}`

    const toOriginalName = (name: string) => toActualName(name).replace(`-${resourcesNamesPostfix}`, '')

    const dockerOrganizationName = toActualName('repo')

    const { dockerRegistry, npmRegistry, gitServer, redisServerUrl } = testFuncs.getResources()

    const { repoName, repoOrg, repoPath, subPackagesFolderPath } = await createGitRepo({
      packageManager: PackageManager.yarn1,
      repo,
      gitServer,
      toActualName,
      gitIgnoreFiles: ['*.log'],
      npm: testFuncs.getResources().npmRegistry,
      processEnv: testFuncs.getProcessEnv(),
    })

    const testLogger = await testFuncs.createTestLogger(repoPath)
    const testLog = testLogger.createLog('test')

    const runCi: RunCi = async ({ targetsInfo, execaOptions } = {}) => {
      return runCiUsingConfigFile({
        repoPath,
        testOptions: {
          targetsInfo,
          execaOptions,
        },
        dockerOrganizationName,
        dockerRegistry,
        npmRegistry,
        toOriginalName,
        redisServerUrl,
        testLogger,
        processEnv: testFuncs.getProcessEnv(),
      })
    }

    return {
      gitHeadCommit: () =>
        execa.command(`git rev-parse HEAD`, { stdio: 'pipe', cwd: repoPath }).then(r => r.stdout.slice(0, 8)),
      repoPath,
      toActualName,
      getPackagePath: getPackagePath(repoPath, toActualName, testFuncs.getProcessEnv()),
      getFullImageName: (packageName, imageTag) =>
        buildFullDockerImageName({
          dockerOrganizationName,
          dockerRegistry: dockerRegistry,
          imageName: toActualName(packageName),
          imageTag,
        }),
      addRandomFileToPackage: addRandomFileToPackage({
        repoPath,
        gitRepoAddress: gitServer.generateGitRepositoryAddress(repoOrg, repoName),
        toActualName,
        processEnv: testFuncs.getProcessEnv(),
      }),
      addRandomFileToRoot: () =>
        addRandomFileToRoot({
          repoPath,
          gitRepoAddress: gitServer.generateGitRepositoryAddress(repoOrg, repoName),
        }),
      npmRegistryAddress: npmRegistry.address,
      runCi,
      dockerOrganizationName,
      installAndRunNpmDependency: dependencyName =>
        installAndRunNpmDependency({
          createRepo: createAndManageRepo,
          npmRegistry,
          toActualName,
          dependencyName,
          log: testLog,
          repoPath,
          processEnv: testFuncs.getProcessEnv(),
        }),
      publishNpmPackageWithoutCi: packageName =>
        publishNpmPackageWithoutCi({
          npmRegistry,
          packageName,
          repoPath,
          toActualName,
          log: testLog,
          processEnv: testFuncs.getProcessEnv(),
        }),
      unpublishNpmPackage: (packageName, versionToUnpublish) =>
        unpublishNpmPackage({
          npmRegistry,
          packageName,
          versionToUnpublish,
          toActualName,
          repoPath,
          log: testLog,
          processEnv: testFuncs.getProcessEnv(),
        }),
      removeAllNpmHashTags: packageName =>
        removeAllNpmHashTags({
          redisServerUrl,
          packageName: toActualName(packageName),
        }),
      modifyPackageJson: (packageName, modification) =>
        modifyPackageJson({
          repoPath,
          gitRepoAddress: gitServer.generateGitRepositoryAddress(repoOrg, repoName),
          toActualName,
          packageName,
          modification,
          processEnv: testFuncs.getProcessEnv(),
        }),
      publishDockerPackageWithoutCi: (packageName, imageTag, labels) =>
        publishDockerPackageWithoutCi({
          repoPath,
          toActualName,
          packageName,
          imageTag,
          dockerOrganizationName,
          dockerRegistry,
          labels,
          processEnv: testFuncs.getProcessEnv(),
        }),
      createNewPackage: (newNpmPackage: MinimalNpmPackage) =>
        createNewPackage({
          createUnderFolderPath: subPackagesFolderPath,
          gitRepoAddress: gitServer.generateGitRepositoryAddress(repoOrg, repoName),
          newNpmPackage,
          repoPath,
          toActualName,
          npmRegistryAddressToPublish: npmRegistry.address,
          processEnv: testFuncs.getProcessEnv(),
        }),
      deletePackage: (packageName: string) =>
        deletePackage({
          gitRepoAddress: gitServer.generateGitRepositoryAddress(repoOrg, repoName),
          repoPath,
          toActualName,
          packageName,
          npmRegistry,
          log: testLog,
          processEnv: testFuncs.getProcessEnv(),
        }),
      movePackageFolder: (packageName: string) =>
        movePackageFolder({
          gitRepoAddress: gitServer.generateGitRepositoryAddress(repoOrg, repoName),
          repoPath,
          toActualName,
          packageName,
          newParentDirPath: subPackagesFolderPath,
          processEnv: testFuncs.getProcessEnv(),
        }),
      renamePackageFolder: (packageName: string) =>
        renamePackageFolder({
          gitRepoAddress: gitServer.generateGitRepositoryAddress(repoOrg, repoName),
          repoPath,
          toActualName,
          packageName,
          processEnv: testFuncs.getProcessEnv(),
        }),
    }
  }

  return {
    ...testFuncs,
    createRepo: createAndManageRepo,
  }
}
