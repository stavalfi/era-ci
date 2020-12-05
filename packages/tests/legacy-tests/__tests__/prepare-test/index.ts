/// <reference path="../../../../../declarations.d.ts" />

import { buildFullDockerImageName } from '@tahini/utils'
import { LogLevel } from '@tahini/core'
import { winstonLogger } from '@tahini/loggers'
import chance from 'chance'
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
import { CreateAndManageRepo, GetFlowLogs, MinimalNpmPackage, NewEnv, RunCi } from './types'
import { getPackagePath, runCiUsingConfigFile, runNcExecutable } from './utils'

export const newEnv: NewEnv = () => {
  const testResources = prepareTestResources()

  const createAndManageRepo: CreateAndManageRepo = async (repo = {}) => {
    const resourcesNamesPostfix = chance().hash().slice(0, 8)

    const toActualName = (name: string) =>
      name.endsWith(`-${resourcesNamesPostfix}`) ? name : `${name}-${resourcesNamesPostfix}`

    const toOriginalName = (name: string) => toActualName(name).replace(`-${resourcesNamesPostfix}`, '')

    const dockerOrganizationName = toActualName('repo')

    const { dockerRegistry, npmRegistry, gitServer, redisServer } = testResources.get()

    const { repoPath, repoName, repoOrg, subPackagesFolderPath } = await createRepo({
      repo,
      gitServer,
      toActualName,
      gitIgnoreFiles: ['nc.log', 'test-logs.log'],
    })

    const testLog = (
      await winstonLogger({
        customLogLevel: LogLevel.trace,
        logFilePath: 'test-logs.log',
        disabled: true,
      }).callInitializeLogger({ repoPath })
    ).createLog('nc-tests')

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
        log: testLog,
        redisServer,
      })
    }

    return {
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
    getTestResources: () => {
      const { dockerRegistry, gitServer, npmRegistry, redisServer } = testResources.get()
      return {
        dockerRegistry,
        gitServer: gitServer.getServerInfo(),
        npmRegistry,
        redisServer,
      }
    },
  }
}
