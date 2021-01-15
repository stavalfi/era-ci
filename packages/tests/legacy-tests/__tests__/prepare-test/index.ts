/// <reference path="../../../../../declarations.d.ts" />

import { LogLevel } from '@era-ci/core'
import { winstonLogger } from '@era-ci/loggers'
import { buildFullDockerImageName } from '@era-ci/utils'
import anyTest from 'ava'
import chance from 'chance'
import execa from 'execa'
import { createRepo } from './create-repo'
import { prepareTestResources } from './prepare-test-resources'
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
import { CreateAndManageRepo, GetFlowLogs, MinimalNpmPackage, NewEnv, RunCi, TestWithContext } from './types'
import { getPackagePath, runCiUsingConfigFile, runNcExecutable } from './utils'

export const describe = (_title: string, func: () => void) => func()

export const test = anyTest as TestWithContext

export const newEnv: NewEnv = test => {
  prepareTestResources(test)

  const createAndManageRepo: CreateAndManageRepo = async (t, repo = {}) => {
    const resourcesNamesPostfix = chance().hash().slice(0, 8)

    const toActualName = (name: string) =>
      name.endsWith(`-${resourcesNamesPostfix}`) ? name : `${name}-${resourcesNamesPostfix}`

    const toOriginalName = (name: string) => toActualName(name).replace(`-${resourcesNamesPostfix}`, '')

    const dockerOrganizationName = toActualName('repo')

    const { dockerRegistry, npmRegistry, gitServer, redisServer } = t.context.resources

    const { repoPath, repoName, repoOrg, subPackagesFolderPath } = await createRepo({
      repo,
      gitServer,
      toActualName,
      gitIgnoreFiles: ['era-ci.log', 'test-logs.log'],
    })

    const testLog = (
      await winstonLogger({
        customLogLevel: LogLevel.trace,
        logFilePath: 'test-logs.log',
        disabled: true,
      }).callInitializeLogger({ repoPath, customLog: t.log.bind(t) })
    ).createLog('era-ci-tests')

    const getFlowLogs: GetFlowLogs = async ({ flowId, execaOptions }) => {
      return runNcExecutable({
        repoPath,
        testOptions: {
          execaOptions,
        },
        printFlowId: flowId,
        dockerOrganizationName,
        dockerRegistry,
        npmRegistry,
        redisServer,
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
        redisServer,
      })
    }

    return {
      gitHeadCommit: () => execa.command(`git rev-parse HEAD`, { stdio: 'pipe', cwd: repoPath }).then(r => r.stdout),
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
          t,
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
          redisServer,
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
    createRepo: createAndManageRepo,
  }
}
