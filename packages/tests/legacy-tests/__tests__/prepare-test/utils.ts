import { ci, CiResult, config, Logger, LogLevel } from '@era-ci/core'
import { winstonLogger } from '@era-ci/loggers'
import {
  buildRoot,
  cliTableReporter,
  dockerPublish,
  installRoot,
  jsonReporter,
  npmPublish,
  NpmScopeAccess,
  test,
  validatePackages,
} from '@era-ci/steps'
import { createLinearStepsGraph } from '@era-ci/steps-graph'
import { localSequentalTaskQueue, taskWorkerTaskQueue } from '@era-ci/task-queues'
import { distructPackageJsonName, getPackages } from '@era-ci/utils'
import chance from 'chance'
import colors from 'colors/safe'
import fs from 'fs'
import path from 'path'
import { latestNpmPackageVersion, publishedDockerImageTags, publishedNpmPackageVersions } from './seach-targets'
import { CiResults, ResultingArtifact, TestOptions, ToActualName } from './types'

export const getPackagePath = (repoPath: string, toActualName: ToActualName, processEnv: NodeJS.ProcessEnv) => async (
  packageName: string,
) => {
  const packagesPath = await getPackages({ repoPath, processEnv }).then(r => Object.values(r).map(w => w.location))
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
  dockerOrganizationName,
  dockerRegistry,
  redisServerUrl,
  npmRegistry,
  processEnv,
}: {
  repoPath: string
  testOptions?: TestOptions
  redisServerUrl: string
  npmRegistry: { address: string; auth: { username: string; password: string; email: string } }
  dockerRegistry: string
  dockerOrganizationName: string
  processEnv: NodeJS.ProcessEnv
}): Promise<CiResult> {
  const logger = winstonLogger({
    customLogLevel: LogLevel.trace,
    disabled: false,
    logFilePath: './era-ci.log',
  })

  const steps = createLinearStepsGraph([
    validatePackages(),
    installRoot({ isStepEnabled: true }),
    buildRoot({ isStepEnabled: true, scriptName: 'build' }),
    test({
      isStepEnabled: true,
      scriptName: 'test',
    }),
    npmPublish({
      isStepEnabled: Boolean(testOptions?.targetsInfo?.npm?.shouldPublish),
      npmScopeAccess: NpmScopeAccess.public,
      registry: npmRegistry.address,
      registryAuth: {
        email: npmRegistry.auth.email,
        username: npmRegistry.auth.username,
        password: npmRegistry.auth.password,
      },
    }),
    dockerPublish({
      isStepEnabled: Boolean(testOptions?.targetsInfo?.docker?.shouldPublish),
      dockerOrganizationName: dockerOrganizationName,
      dockerRegistry: dockerRegistry,
    }),
    jsonReporter(),
    cliTableReporter({ colorizeTable: s => colors.white(s) }),
  ])

  const ciConfig = config({
    taskQueues: [
      localSequentalTaskQueue(),
      taskWorkerTaskQueue({
        queueName: `queue-${chance().hash().slice(0, 8)}`,
        redis: {
          url: redisServerUrl,
        },
      }),
    ],
    steps,
    redis: {
      url: redisServerUrl,
    },
    logger,
  })

  return ci({
    repoPath,
    config: ciConfig,
    processEnv: {
      ERA_TEST_MODE: 'true',
      ...processEnv,
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
  redisServerUrl,
  printFlowId,
  testLogger,
  processEnv,
}: {
  repoPath: string
  testOptions?: TestOptions
  npmRegistry: { address: string; auth: { username: string; password: string; email: string } }
  dockerRegistry: string
  dockerOrganizationName: string
  toOriginalName: (packageName: string) => string
  redisServerUrl: string
  printFlowId?: string
  testLogger: Logger
  processEnv: NodeJS.ProcessEnv
}): Promise<CiResults> {
  const ciResult = await runNcExecutable({
    repoPath,
    testOptions,
    dockerOrganizationName,
    dockerRegistry,
    npmRegistry,
    redisServerUrl,
    processEnv,
  })

  async function getPublishResult() {
    // the test can add/remove/modify packages between the creation of the repo until
    // the call of the ci so we need to find all the packages again
    const packagesPaths = await getPackages({ repoPath, processEnv }).then(r => Object.values(r).map(w => w.location))
    const packages = await Promise.all(
      packagesPaths
        .map(packagePath => JSON.parse(fs.readFileSync(path.join(packagePath, 'package.json'), 'utf-8')).name)
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

  const flowLogs = await fs.promises.readFile(path.join(repoPath, 'era-ci.log'), 'utf-8')

  return {
    published: new Map(
      Object.values(testOptions?.targetsInfo || {}).some(x => x?.shouldPublish) ? await getPublishResult() : [],
    ),
    passed: ciResult.passed,
    flowLogs,
    flowId: ciResult.flowId,
  }
}
