import { LogLevel } from '@era-ci/core'
import { winstonLogger } from '@era-ci/loggers'
import { distructPackageJsonName, execaCommand } from '@era-ci/utils'
import { ExecutionContext } from 'ava'
import execa, { StdioOption } from 'execa'
import fse from 'fs-extra'
import path from 'path'
import { latestNpmPackageVersion, publishedDockerImageTags, publishedNpmPackageVersions } from './seach-targets'
import { CiResults, ResultingArtifact, TestOptions, TestWithContextType, ToActualName } from './types'

export async function getPackages(repoPath: string): Promise<Array<string>> {
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

export async function runNcExecutable({
  testOptions,
  repoPath,
  printFlowId,
  dockerOrganizationName,
  dockerRegistry,
  redisServer,
  npmRegistry,
  t,
}: {
  repoPath: string
  testOptions?: TestOptions
  printFlowId?: string
  redisServer: string
  npmRegistry: { address: string; auth: { username: string; token: string; email: string } }
  dockerRegistry: string
  dockerOrganizationName: string
  t: ExecutionContext<TestWithContextType>
}): Promise<execa.ExecaReturnValue<string>> {
  const testLogger = await winstonLogger({
    disabled: true, // change to false if you need to see logs
    customLogLevel: LogLevel.trace,
    logFilePath: path.join(repoPath, 'test-logs.log'),
    disableFileOutput: true,
  }).callInitializeLogger({ repoPath, customLog: t.log.bind(t) })

  let stdio: 'pipe' | 'ignore' | 'inherit' | Array<StdioOption>
  // eslint-disable-next-line no-process-env
  if (process.env.GITHUB_RUN_NUMBER || printFlowId) {
    stdio = 'pipe'
  } else {
    if (testOptions?.execaOptions?.stdio) {
      stdio = testOptions.execaOptions.stdio
    } else {
      stdio = 'inherit'
    }
  }
  const configFilePath = require.resolve('./test-era-ci.config.ts')
  const eraCi = require.resolve('@era-ci/core/dist/src/index.js')
  const withFlowId = printFlowId ? `--print-flow ${printFlowId}` : ''
  const command = `node --unhandled-rejections=strict ${eraCi} --config-file ${configFilePath} --repo-path ${repoPath} ${withFlowId}`

  return execaCommand(command, {
    log: testLogger.createLog(''),
    stdio,
    reject: testOptions?.execaOptions?.reject !== undefined ? testOptions.execaOptions?.reject : true,
    env: {
      SHOULD_PUBLISH_NPM: testOptions?.targetsInfo?.npm?.shouldPublish ? 'true' : '',
      SHOULD_PUBLISH_DOCKER: testOptions?.targetsInfo?.docker?.shouldPublish ? 'true' : '',
      DOCKER_ORGANIZATION_NAME: dockerOrganizationName,
      DOCKER_REGISTRY: dockerRegistry,
      NPM_REGISTRY: npmRegistry.address,
      NPM_EMAIL: npmRegistry.auth.email,
      NPM_USERNAME: npmRegistry.auth.username,
      NPM_TOKEN: npmRegistry.auth.token,
      DOCKER_HUB_USERNAME: '',
      DOCKER_HUB_TOKEN: '',
      REDIS_ENDPOINT: redisServer,
      TEST_SCRIPT_NAME: 'test',
      NC_TEST_MODE: 'true',
    },
  })
}

export async function runCiUsingConfigFile({
  repoPath,
  testOptions,
  dockerOrganizationName,
  dockerRegistry,
  npmRegistry,
  toOriginalName,
  redisServer,
  printFlowId,
  t,
}: {
  repoPath: string
  testOptions?: TestOptions
  npmRegistry: { address: string; auth: { username: string; token: string; email: string } }
  dockerRegistry: string
  dockerOrganizationName: string
  toOriginalName: (packageName: string) => string
  redisServer: string
  printFlowId?: string
  t: ExecutionContext<TestWithContextType>
}): Promise<CiResults> {
  const ciProcessResult = await runNcExecutable({
    t,
    repoPath,
    testOptions,
    dockerOrganizationName,
    dockerRegistry,
    npmRegistry,
    redisServer,
    printFlowId,
  })

  async function getPublishResult() {
    // the test can add/remove/modify packages between the creation of the repo until
    // the call of the ci so we need to find all the packages again
    const packagesPaths = await getPackages(repoPath)
    const packages = await Promise.all(
      packagesPaths
        .map(packagePath => fse.readJSONSync(path.join(packagePath, 'package.json')).name)
        .map<Promise<[string, ResultingArtifact]>>(async (packageName: string) => {
          const [versions, highestVersion, tags] = await Promise.all([
            publishedNpmPackageVersions(packageName, npmRegistry.address),
            latestNpmPackageVersion(packageName, npmRegistry.address),
            publishedDockerImageTags({
              imageName: distructPackageJsonName(packageName).name,
              dockerOrganizationName,
              dockerRegistry,
            }),
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
    return published
  }

  const ncLogfileContent = await fse.readFile(path.join(repoPath, 'era-ci.log'), 'utf-8')

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
    published: new Map(
      Object.values(testOptions?.targetsInfo || {}).some(x => x?.shouldPublish) ? await getPublishResult() : [],
    ),
    ciProcessResult,
    ncLogfileContent,
    flowId,
  }
}
