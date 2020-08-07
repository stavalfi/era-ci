import chance from 'chance'
import ciInfo from 'ci-info'
import execa from 'execa'
import fse from 'fs-extra'
import { ConfigFileOptions, TargetType, DeployTarget } from 'nc/src/types'
import path from 'path'
import { createRepo } from './create-repo'
import { prepareTestResources } from './prepare-test-resources'
import { latestNpmPackageVersion, publishedDockerImageTags, publishedNpmPackageVersions } from './seach-targets'
import {
  addRandomFileToPackage,
  addRandomFileToRoot,
  commitAllAndPushChanges,
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
import { CreateAndManageRepo, MinimalNpmPackage, NewEnv, ResultingArtifact, RunCi } from './types'
import { getPackagePath, getPackages, ignore } from './utils'

export { runDockerImage } from './test-helpers'

export const newEnv: NewEnv = () => {
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

    const runCi: RunCi = async ({ targetsInfo, execaOptions } = {}) => {
      const configFilePath = path.join(repoPath, 'nc.config.ts')
      const [npmDeploymentLogic, dockerDeploymentLogic]: [
        DeployTarget<unknown, TargetType.npm>,
        DeployTarget<unknown, TargetType.docker>,
        // @ts-expect-error
      ] = [chance().hash(), chance().hash()]
      const configurations: ConfigFileOptions<unknown> = {
        targetsInfo: {
          npm: targetsInfo?.npm && {
            shouldPublish: targetsInfo.npm.shouldPublish,
            registry: `${npmRegistry.protocol}://${npmRegistry.host}:${npmRegistry.port}`,
            publishAuth: npmRegistry.auth,
            ...(targetsInfo.npm.shouldDeploy
              ? {
                  shouldDeploy: true,
                  deployment: npmDeploymentLogic,
                }
              : {
                  shouldDeploy: false,
                }),
          },
          docker: targetsInfo?.docker && {
            shouldPublish: targetsInfo.docker.shouldPublish,
            registry: `${dockerRegistry.protocol}://${dockerRegistry.host}:${dockerRegistry.port}`,
            publishAuth: {
              token: '',
              username: '',
            },
            dockerOrganizationName,
            ...(targetsInfo.docker.shouldDeploy
              ? {
                  shouldDeploy: true,
                  deployment: dockerDeploymentLogic,
                }
              : {
                  shouldDeploy: false,
                }),
          },
        },
        redis: {
          redisServer: `redis://${redisServer.host}:${redisServer.port}/`,
          auth: {
            password: '',
          },
        },
        git: {
          auth: {
            username: gitServer.getUsername(),
            token: gitServer.getToken(),
          },
        },
      }

      const asString = JSON.stringify(configurations, null, 2)
      let finalString = `export default async () => (${asString})`

      if (targetsInfo?.npm?.shouldDeploy) {
        finalString = finalString.replace(`"${npmDeploymentLogic}"`, targetsInfo.npm.deploymentStrigifiedSection)
      }
      if (targetsInfo?.docker?.shouldDeploy) {
        finalString = finalString.replace(`"${dockerDeploymentLogic}"`, targetsInfo.docker.deploymentStrigifiedSection)
      }

      await fse.remove(configFilePath).catch(ignore)
      await fse.writeFile(configFilePath, finalString, 'utf-8')
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
          .map<Promise<[string, ResultingArtifact]>>(async (packageName: string) => {
            const [versions, highestVersion, tags] = await Promise.all([
              publishedNpmPackageVersions(packageName, npmRegistry),
              latestNpmPackageVersion(packageName, npmRegistry),
              publishedDockerImageTags(packageName, dockerOrganizationName, dockerRegistry),
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
                },
              },
            ]
          }),
      )

      const published = packages.filter(
        ([, artifact]) =>
          artifact.docker.tags.length > 0 || artifact.npm.versions.length > 0 || artifact.npm.highestVersion,
      )

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
