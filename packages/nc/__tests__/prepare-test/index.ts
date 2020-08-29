import chance from 'chance'
import { buildFullDockerImageName, getNpmRegistryAddress } from '../../src'
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
import { CreateAndManageRepo, MinimalNpmPackage, NewEnv, RunCi } from './types'
import { createConfigFile, getPackagePath, runCiUsingConfigFile } from './utils'

export const newEnv: NewEnv = () => {
  const testResources = prepareTestResources()

  const createAndManageReo: CreateAndManageRepo = async (repo = {}) => {
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
    })

    const runCi: RunCi = async ({ targetsInfo, execaOptions, editConfig } = {}) => {
      const configFilePath = await createConfigFile({
        dockerOrganizationName,
        dockerRegistry,
        gitServer,
        npmRegistry,
        redisServer,
        repoName,
        repoOrg,
        repoPath,
        targetsInfo,
        editConfig,
      })

      return runCiUsingConfigFile({
        configFilePath,
        repoPath,
        execaOptions,
        dockerOrganizationName,
        dockerRegistry,
        npmRegistry,
        toOriginalName,
      })
    }

    return {
      repoPath,
      toActualName,
      getPackagePath: getPackagePath(repoPath, toActualName),
      getFullImageName: (packageName, imageTag) =>
        buildFullDockerImageName({
          dockerOrganizationName,
          dockerRegistry,
          packageJsonName: toActualName(packageName),
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
      npmRegistryAddress: getNpmRegistryAddress(npmRegistry),
      runCi,
      dockerOrganizationName,
      installAndRunNpmDependency: dependencyName =>
        installAndRunNpmDependency({
          createRepo: createAndManageReo,
          npmRegistry: testResources.get().npmRegistry,
          toActualName,
          dependencyName,
        }),
      publishNpmPackageWithoutCi: packageName =>
        publishNpmPackageWithoutCi({
          npmRegistry,
          npmRegistryEmail: npmRegistry.auth.email,
          npmRegistryToken: npmRegistry.auth.token,
          npmRegistryUsername: npmRegistry.auth.username,
          packageName,
          repoPath,
          toActualName,
        }),
      unpublishNpmPackage: (packageName, versionToUnpublish) =>
        unpublishNpmPackage({
          npmRegistry,
          npmRegistryEmail: npmRegistry.auth.email,
          npmRegistryToken: npmRegistry.auth.token,
          npmRegistryUsername: npmRegistry.auth.username,
          packageName,
          versionToUnpublish,
          toActualName,
          repoPath,
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
    createRepo: createAndManageReo,
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
