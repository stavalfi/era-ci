import chance from 'chance'
import { runCiCli } from '../../src/ci-node-api'
import { createRepo } from './create-repo'
import { prepareTestResources } from './prepare-test-resources'
import {
  latestDockerImageTag,
  latestNpmPackageVersion,
  publishedDockerImageTags,
  publishedNpmPackageVersions,
} from './seach-targets'
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
  unpublishNpmPackage,
  renamePackageFolder,
} from './test-helpers'
import { CreateAndManageRepo, MinimalNpmPackage, NewEnvFunc, PublishedPackageInfo, RunCi } from './types'
import { getPackagePath, getPackages } from './utils'
import path from 'path'

export { runDockerImage } from './test-helpers'

export const newEnv: NewEnvFunc = () => {
  const testResources = prepareTestResources()

  const createAndManageReo: CreateAndManageRepo = async (repo = {}) => {
    const resourcesNamesPostfix = chance()
      .hash()
      .slice(0, 8)

    const toActualName = (name: string) =>
      name.endsWith(`-${resourcesNamesPostfix}`) ? name : `${name}-${resourcesNamesPostfix}`

    const dockerOrganizationName = toActualName('repo')

    const { dockerRegistry, npmRegistry, gitServer, redisServer } = testResources.get()

    const { repoPath, repoName, repoOrg, subPackagesFolderPath } = await createRepo({
      repo,
      gitServer,
      toActualName,
    })

    const runCi: RunCi = async ({ isMasterBuild, isDryRun, skipTests, stdio = 'inherit' }) => {
      await runCiCli(
        {
          isMasterBuild,
          skipTests: Boolean(skipTests),
          isDryRun: Boolean(isDryRun),
          dockerOrganizationName,
          gitOrganizationName: repoOrg,
          gitRepositoryName: repoName,
          rootPath: repoPath,
          dockerRegistry,
          gitServer: gitServer.getServerInfo(),
          npmRegistry,
          redisServer: {
            host: redisServer.host,
            port: redisServer.port,
          },
          auth: {
            ...npmRegistry.auth,
            gitServerToken: gitServer.getToken(),
            gitServerUsername: gitServer.getUsername(),
          },
        },
        stdio,
      )

      // the test can add/remove/modify packages between the creation of the repo until the call of the ci so we need to find all the packages again
      const packagesPaths = await getPackages(repoPath)
      const packages = await Promise.all(
        packagesPaths // todo: need to search in runtime which packages I have NOW
          .map(packagePath => require(path.join(packagePath, 'package.json')).name)
          .map<Promise<[string, PublishedPackageInfo]>>(async (packageName: string) => {
            const actualName = toActualName(packageName)
            const [versions, latestVersion, tags, latestTag] = await Promise.all([
              publishedNpmPackageVersions(actualName, npmRegistry),
              latestNpmPackageVersion(actualName, npmRegistry),
              publishedDockerImageTags(actualName, dockerOrganizationName, dockerRegistry),
              latestDockerImageTag(actualName, dockerOrganizationName, dockerRegistry),
            ])
            return [
              packageName,
              {
                npm: {
                  versions,
                  latestVersion,
                },
                docker: {
                  tags,
                  latestTag,
                },
              },
            ]
          }),
      )

      const published = packages.filter(
        ([, packageInfo]) => packageInfo.docker.latestTag || packageInfo.npm.latestVersion,
      )

      return {
        published: new Map(published),
      }
    }

    return {
      repoPath,
      toActualName,
      getPackagePath: getPackagePath(repoPath, toActualName),
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
      npmRegistryAddress: `${npmRegistry.protocol}://${npmRegistry.host}:${npmRegistry.port}`,
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
          npmRegistryEmail: npmRegistry.auth.npmRegistryEmail,
          npmRegistryToken: npmRegistry.auth.npmRegistryToken,
          npmRegistryUsername: npmRegistry.auth.npmRegistryUsername,
          packageName,
          repoPath,
          toActualName,
        }),
      unpublishNpmPackage: (packageName, versionToUnpublish) =>
        unpublishNpmPackage({
          npmRegistry,
          npmRegistryEmail: npmRegistry.auth.npmRegistryEmail,
          npmRegistryToken: npmRegistry.auth.npmRegistryToken,
          npmRegistryUsername: npmRegistry.auth.npmRegistryUsername,
          packageName,
          versionToUnpublish,
          toActualName,
        }),
      removeAllNpmHashTags: packageName =>
        removeAllNpmHashTags({
          npmRegistry,
          npmRegistryEmail: npmRegistry.auth.npmRegistryEmail,
          npmRegistryToken: npmRegistry.auth.npmRegistryToken,
          npmRegistryUsername: npmRegistry.auth.npmRegistryUsername,
          packageName,
          repoPath,
          toActualName,
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
