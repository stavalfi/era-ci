/// <reference path="../../../../../declarations.d.ts" />

import { createTest } from '@era-ci/e2e-tests-infra'
import { buildFullDockerImageName } from '@era-ci/utils'
import chance from 'chance'
import execa from 'execa'
import { createRepo } from './create-repo'
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
import { CreateAndManageRepo, GetFlowLogs, MinimalNpmPackage, NewEnv, RunCi } from './types'
import { getPackagePath, runCiUsingConfigFile, runNcExecutable } from './utils'

export const newEnv: NewEnv = () => {
  const testFuncs = createTest()

  const createAndManageRepo: CreateAndManageRepo = async (repo = {}) => {
    const resourcesNamesPostfix = chance().hash().slice(0, 8)

    const toActualName = (name: string) =>
      name.endsWith(`-${resourcesNamesPostfix}`) ? name : `${name}-${resourcesNamesPostfix}`

    const toOriginalName = (name: string) => toActualName(name).replace(`-${resourcesNamesPostfix}`, '')

    const dockerOrganizationName = toActualName('repo')

    const { dockerRegistry, npmRegistry, gitServer, redisServerUrl } = testFuncs.getResources()

    const { repoPath, repoName, repoOrg, subPackagesFolderPath } = await createRepo({
      repo,
      gitServer,
      toActualName,
      gitIgnoreFiles: ['*.log'],
    })

    // only login to npm like this in tests. publishing in non-interactive mode is very buggy and tricky.
    await execa.command(require.resolve(`.bin/npm-login-noninteractive`), {
      stdio: 'ignore',
      cwd: repoPath,
      env: {
        NPM_USER: testFuncs.getResources().npmRegistry.auth.username,
        NPM_PASS: testFuncs.getResources().npmRegistry.auth.token,
        NPM_EMAIL: testFuncs.getResources().npmRegistry.auth.email,
        NPM_REGISTRY: testFuncs.getResources().npmRegistry.address,
      },
    })

    const testLogger = await testFuncs.createTestLogger(repoPath)
    const testLog = testLogger.createLog('test-infra')

    const getFlowLogs: GetFlowLogs = async ({ flowId, execaOptions }) => {
      return runNcExecutable({
        testLogger,
        repoPath,
        testOptions: {
          execaOptions,
        },
        printFlowId: flowId,
        dockerOrganizationName,
        dockerRegistry,
        npmRegistry,
        redisServerUrl,
      })
    }

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
      })
    }

    return {
      gitHeadCommit: () =>
        execa.command(`git rev-parse HEAD`, { stdio: 'pipe', cwd: repoPath }).then(r => r.stdout.slice(0, 8)),
      repoPath,
      toActualName,
      getPackagePath: getPackagePath(repoPath, toActualName),
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
      }),
      addRandomFileToRoot: () =>
        addRandomFileToRoot({
          repoPath,
          gitRepoAddress: gitServer.generateGitRepositoryAddress(repoOrg, repoName),
        }),
      npmRegistryAddress: npmRegistry.address,
      runCi,
      getFlowLogs,
      dockerOrganizationName,
      installAndRunNpmDependency: dependencyName =>
        installAndRunNpmDependency({
          createRepo: createAndManageRepo,
          npmRegistry,
          toActualName,
          dependencyName,
        }),
      publishNpmPackageWithoutCi: packageName =>
        publishNpmPackageWithoutCi({
          npmRegistry,
          packageName,
          repoPath,
          toActualName,
          log: testLog,
        }),
      unpublishNpmPackage: (packageName, versionToUnpublish) =>
        unpublishNpmPackage({
          npmRegistry,
          packageName,
          versionToUnpublish,
          toActualName,
          repoPath,
          log: testLog,
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
        }),
      createNewPackage: (newNpmPackage: MinimalNpmPackage) =>
        createNewPackage({
          createUnderFolderPath: subPackagesFolderPath,
          gitRepoAddress: gitServer.generateGitRepositoryAddress(repoOrg, repoName),
          newNpmPackage,
          repoPath,
          toActualName,
        }),
      deletePackage: (packageName: string) =>
        deletePackage({
          gitRepoAddress: gitServer.generateGitRepositoryAddress(repoOrg, repoName),
          repoPath,
          toActualName,
          packageName,
        }),
      movePackageFolder: (packageName: string) =>
        movePackageFolder({
          gitRepoAddress: gitServer.generateGitRepositoryAddress(repoOrg, repoName),
          repoPath,
          toActualName,
          packageName,
          newParentDirPath: subPackagesFolderPath,
        }),
      renamePackageFolder: (packageName: string) =>
        renamePackageFolder({
          gitRepoAddress: gitServer.generateGitRepositoryAddress(repoOrg, repoName),
          repoPath,
          toActualName,
          packageName,
        }),
    }
  }

  return {
    ...testFuncs,
    createRepo: createAndManageRepo,
  }
}
