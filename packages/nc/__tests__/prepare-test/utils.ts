import chance from 'chance'
import execa from 'execa'
import fse from 'fs-extra'
import path from 'path'
import { ConfigFileOptions, DeployTarget, ServerInfo, TargetType } from '../../src/index'
import { GitServer } from './git-server-testkit'
import { commitAllAndPushChanges } from './test-helpers'
import { TestOptions, ToActualName, ResultingArtifact, EditConfig } from './types'
import { publishedNpmPackageVersions, latestNpmPackageVersion, publishedDockerImageTags } from './seach-targets'
import ciInfo from 'ci-info'
import _ from 'lodash'

export async function getPackages(repoPath: string): Promise<string[]> {
  const result = await execa.command('yarn workspaces --json info', {
    cwd: repoPath,
  })
  const workspacesInfo: { location: string }[] = JSON.parse(JSON.parse(result.stdout).data)
  return Object.values(workspacesInfo || {})
    .map(workspaceInfo => workspaceInfo.location)
    .map(relativePackagePath => path.join(repoPath, relativePackagePath))
}

export const getPackagePath = (repoPath: string, toActualName: ToActualName) => async (packageName: string) => {
  const packagesPath = await getPackages(repoPath)
  const packagePath = packagesPath.find(path => path.endsWith(toActualName(packageName)))
  if (!packagePath) {
    throw new Error(
      `bug: could not create repo correctly. missing folder: packages/${toActualName(packageName)} in: ${repoPath}`,
    )
  }
  return packagePath
}

export const ignore = () => {
  // ignore
}

export async function createConfigFile({
  repoName,
  repoOrg,
  targetsInfo,
  dockerOrganizationName,
  repoPath,
  dockerRegistry,
  gitServer,
  npmRegistry,
  redisServer,
  editConfig,
}: {
  repoOrg: string
  repoName: string
  repoPath: string
  targetsInfo: TestOptions['targetsInfo']
  gitServer: GitServer
  redisServer: ServerInfo
  npmRegistry: ServerInfo & { auth: { username: string; token: string; email: string } }
  dockerRegistry: ServerInfo
  dockerOrganizationName: string
  editConfig?: EditConfig
}): Promise<string> {
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

  const finalConfigurations = editConfig ? editConfig(_.cloneDeep(configurations)) : configurations

  const asString = JSON.stringify(finalConfigurations, null, 2)
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

  return configFilePath
}

export async function runCiUsingConfigFile({
  configFilePath,
  repoPath,
  execaOptions,
  dockerOrganizationName,
  dockerRegistry,
  npmRegistry,
  toOriginalName,
}: {
  configFilePath: string
  repoPath: string
  execaOptions?: TestOptions['execaOptions']
  npmRegistry: ServerInfo & { auth: { username: string; token: string; email: string } }
  dockerRegistry: ServerInfo
  dockerOrganizationName: string
  toOriginalName: (packageName: string) => string
}) {
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

  // the test can add/remove/modify packages between the creation of the repo until
  // the call of the ci so we need to find all the packages again
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
