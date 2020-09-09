import chance from 'chance'
import ciInfo from 'ci-info'
import execa, { StdioOption } from 'execa'
import fse from 'fs-extra'
import _ from 'lodash'
import path from 'path'
import {
  ConfigFileOptions,
  DeployTarget,
  getNpmRegistryAddress,
  NpmScopeAccess,
  ServerInfo,
  TargetType,
} from '../../src'
import { GitServer } from './git-server-testkit'
import { latestNpmPackageVersion, publishedDockerImageTags, publishedNpmPackageVersions } from './seach-targets'
import { commitAllAndPushChanges } from './test-helpers'
import { CiResults, EditConfig, ResultingArtifact, TestOptions, ToActualName } from './types'

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
  logFilePath,
}: {
  logFilePath: string
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
    logFilePath,
    targetsInfo: {
      npm: targetsInfo?.npm && {
        shouldPublish: targetsInfo.npm.shouldPublish,
        npmScopeAccess: targetsInfo.npm.npmScopeAccess || NpmScopeAccess.public,
        registry: getNpmRegistryAddress(npmRegistry),
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

export async function runNcExecutable({
  configFilePath,
  execaOptions,
  repoPath,
  printFlowId,
}: {
  repoPath: string
  configFilePath: string
  execaOptions?: TestOptions['execaOptions']
  printFlowId?: string
}): Promise<execa.ExecaReturnValue<string>> {
  let stdio: 'pipe' | 'ignore' | 'inherit' | readonly StdioOption[]
  if (ciInfo.isCI || printFlowId) {
    stdio = 'pipe'
  } else {
    if (execaOptions?.stdio) {
      stdio = execaOptions.stdio
    } else {
      stdio = 'inherit'
    }
  }

  return execa.command(
    `node --unhandled-rejections=strict ${path.join(
      __dirname,
      '../../dist/src/index.js',
    )} --config-file ${configFilePath} --repo-path ${repoPath} ${printFlowId ? `--print-flow ${printFlowId}` : ''}`,
    {
      stdio,
      reject: execaOptions?.reject !== undefined ? execaOptions?.reject : true,
    },
  )
}

export async function runCiUsingConfigFile({
  configFilePath,
  repoPath,
  execaOptions,
  dockerOrganizationName,
  dockerRegistry,
  npmRegistry,
  toOriginalName,
  logFilePath,
}: {
  logFilePath: string
  configFilePath: string
  repoPath: string
  execaOptions?: TestOptions['execaOptions']
  npmRegistry: ServerInfo & { auth: { username: string; token: string; email: string } }
  dockerRegistry: ServerInfo
  dockerOrganizationName: string
  toOriginalName: (packageName: string) => string
}): Promise<CiResults> {
  const ciProcessResult = await runNcExecutable({
    configFilePath,
    repoPath,
    execaOptions,
  })

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
          publishedDockerImageTags(packageName, dockerOrganizationName, dockerRegistry, repoPath),
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

  const ncLogfileContent = await fse.readFile(logFilePath, 'utf-8')

  const flowIdResult = ncLogfileContent.match(/flow-id: "(.*)"/)
  let flowId: string | undefined
  if (!flowIdResult || flowIdResult.length < 2) {
    // test-infra could not find the flow-id from the log-file using the regex: /flow-id: "(.*)"/.
    // maybe the test failed before the flow-id was generated
    flowId = undefined
  } else {
    flowId = flowIdResult[1]
  }

  return {
    published: new Map(published),
    ciProcessResult,
    ncLogfileContent,
    flowId,
  }
}
