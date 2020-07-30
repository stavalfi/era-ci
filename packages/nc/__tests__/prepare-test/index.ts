import chance from 'chance'
import ciInfo from 'ci-info'
import execa from 'execa'
import fse from 'fs-extra'
import path from 'path'
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
  renamePackageFolder,
  unpublishNpmPackage,
  commitAllAndPushChanges,
} from './test-helpers'
import { CreateAndManageRepo, MinimalNpmPackage, NewEnvFunc, PublishedPackageInfo, RunCi } from './types'
import { getPackagePath, getPackages, ignore } from './utils'
import { ConfigFileOptions } from '@tahini/nc'

export { runDockerImage } from './test-helpers'

export const newEnv: NewEnvFunc = () => {
  const testResources = prepareTestResources()

  const createAndManageReo: CreateAndManageRepo = async (repo = {}) => {
    const resourcesNamesPostfix = chance()
      .hash()
      .slice(0, 8)

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

    const runCi: RunCi = async ({ shouldPublish, execaOptions }) => {
      const configFilePath = path.join(repoPath, 'nc.config.ts')
      const configurations: ConfigFileOptions = {
        shouldPublish,
        dockerOrganizationName,
        gitOrganizationName: repoOrg,
        gitRepositoryName: repoName,
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
      }

      await fse.remove(configFilePath).catch(ignore)
      await fse.writeFile(
        configFilePath,
        `export default async () => (${JSON.stringify(configurations, null, 2)})`,
        'utf-8',
      )
      await commitAllAndPushChanges(repoPath, gitServer.generateGitRepositoryAddress(repoOrg, repoName))

      const ciProcessResult = await execa.command(
        `node --unhandled-rejections=strict ${path.join(
          __dirname,
          '../../dist/src/index.js',
        )} --config-file ${configFilePath} --repo-path ${repoPath}`,
        {
          stdio: ciInfo.isCI ? 'pipe' : execaOptions?.stdio || 'inherit',
          reject: execaOptions?.reject !== undefined ? execaOptions?.reject : true,
        },
      )

      // the test can add/remove/modify packages between the creation of the repo until the call of the ci so we need to find all the packages again
      const packagesPaths = await getPackages(repoPath)
      const packages = await Promise.all(
        packagesPaths // todo: need to search in runtime which packages I have NOW
          .map(packagePath => require(path.join(packagePath, 'package.json')).name)
          .map<Promise<[string, PublishedPackageInfo]>>(async (packageName: string) => {
            const [versions, highestVersion, tags, latestTag] = await Promise.all([
              publishedNpmPackageVersions(packageName, npmRegistry),
              latestNpmPackageVersion(packageName, npmRegistry),
              publishedDockerImageTags(packageName, dockerOrganizationName, dockerRegistry),
              latestDockerImageTag(packageName, dockerOrganizationName, dockerRegistry),
            ])
            return [
              toOriginalName(packageName),
              {
                npm: {
                  versions,
                  highestVersion,
                },
                docker: {
                  tags,
                  latestTag,
                },
              },
            ]
          }),
      )

      const published = packages.filter(([, artifact]) => artifact.docker.latestTag || artifact.npm.highestVersion)

      return {
        published: new Map(published),
        ciProcessResult,
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
