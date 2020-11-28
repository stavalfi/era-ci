import { CreateRepo, createTest, TestResources } from '@tahini/e2e-tests-infra'
import { getDockerImageLabelsAndTags, getGitRepoInfo, Log, Logger, LogLevel, winstonLogger } from '@tahini/nc'
import { startQuayHelperService } from '@tahini/quay-helper-service'
import { startQuayMockService } from '@tahini/quay-mock-service'
import { QuayBuildsTaskQueue, quayBuildsTaskQueue } from '@tahini/quay-task-queue'
import chance from 'chance'
import _ from 'lodash'
import path from 'path'
import semver from 'semver'

type TestDependencies = {
  quayServiceHelper: { address: string; cleanup: () => Promise<unknown> }
  quayMockService: { address: string; cleanup: () => Promise<unknown> }
  quayNamespace: string
  quayToken: string
  repoPath: string
  logger: Logger
  queue: QuayBuildsTaskQueue
  toActualPackageName: (packageName: string) => string
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function beforeAfterEach() {
  const { getResoureces, createRepo } = createTest()

  let testDependencies: TestDependencies

  beforeEach(async () => {
    testDependencies = await createTestDependencies(getResoureces, createRepo)
  })

  afterEach(async () => {
    await Promise.all([
      testDependencies.quayMockService.cleanup(),
      testDependencies.quayServiceHelper.cleanup(),
      testDependencies.queue.cleanup(),
    ])
  })

  const getImageTags = (packageName: string) =>
    publishedDockerImageTags({
      dockerOrganizationName: testDependencies.quayNamespace,
      dockerRegistry: getResoureces().dockerRegistry,
      imageName: testDependencies.toActualPackageName(packageName),
      log: testDependencies.logger.createLog('test'),
      repoPath: testDependencies.repoPath,
    })

  return {
    getImageTags,
    getResoureces: () => {
      const packages = Object.fromEntries(
        _.range(0, 15).map(i => [
          `package${i}`,
          {
            name: testDependencies.toActualPackageName(`package${i}`),
            relativeDockerFilePath: path.join(
              '/',
              'packages',
              testDependencies.toActualPackageName(`package${i}`),
              'Dockerfile',
            ),
          },
        ]),
      )
      return {
        queue: testDependencies.queue,
        repoPath: testDependencies.repoPath,
        packages,
      }
    },
  }
}

export async function publishedDockerImageTags({
  dockerOrganizationName,
  log,
  repoPath,
  dockerRegistry,
  imageName,
}: {
  imageName: string
  dockerOrganizationName: string
  dockerRegistry: string
  repoPath: string
  log: Log
}): Promise<Array<string>> {
  try {
    const result = await getDockerImageLabelsAndTags({
      dockerOrganizationName,
      packageJsonName: imageName,
      dockerRegistry,
      silent: true,
      repoPath,
      log,
    })
    const tags = result?.allTags.filter((tag: string) => semver.valid(tag) || tag === 'latest').filter(Boolean) || []
    const sorted = semver.sort(tags.filter(tag => tag !== 'latest')).concat(tags.includes('latest') ? ['latest'] : [])
    return sorted
  } catch (e) {
    if (e.stderr?.includes('manifest unknown')) {
      return []
    } else {
      throw e
    }
  }
}

async function createTestDependencies(
  getResoureces: () => TestResources,
  createRepo: CreateRepo,
): Promise<TestDependencies> {
  const redisTopic = `redis-topic-${chance().hash().slice(0, 8)}`
  const quayServiceHelper = await startQuayHelperService({
    PORT: '0',
    REDIS_ADDRESS: getResoureces().redisServerUri,
    QUAY_BUILD_STATUS_CHANED_TEST_REDIS_TOPIC: redisTopic,
    NC_TEST_MODE: 'true',
  })
  const quayNamespace = `namespace-${chance().hash().slice(0, 8)}`
  const quayToken = `token-${chance().hash().slice(0, 8)}`
  const quayMockService = await startQuayMockService({
    dockerRegistryAddress: getResoureces().dockerRegistry,
    namespace: quayNamespace,
    token: quayToken,
  })

  const { repoPath, toActualName } = await createRepo({
    packages: _.range(0, 15).map(i => ({
      name: `package${i}`,
      version: '1.0.0',
      additionalFiles: {
        Dockerfile: `\
      FROM alpine
      CMD ["echo","hello"]
      `,
      },
    })),
  })

  const logger = await winstonLogger({
    customLogLevel: LogLevel.debug,
    disabled: false,
    logFilePath: './nc.log',
  }).callInitializeLogger({ repoPath })

  // eslint-disable-next-line no-process-env
  process.env.QUAY_BUILD_STATUS_CHANED_TEST_REDIS_TOPIC = redisTopic

  const queue = await quayBuildsTaskQueue({
    getCommitTarGzPublicAddress: () =>
      `${quayServiceHelper.address}/download-git-repo-tar-gz?git_registry=local-filesystem&repo_abs_path=${repoPath}`,
    getQuayRepoInfo: packageName => ({
      repoName: packageName,
      visibility: 'private',
    }),
    quayAddress: quayMockService.address,
    quayNamespace,
    quayServiceHelperAddress: quayServiceHelper.address,
    quayToken,
    redisAddress: getResoureces().redisServerUri,
    taskTimeoutMs: 10 * 1000,
  }).createFunc({
    log: logger.createLog('quayBuildsTaskQueue'),
    gitRepoInfo: await getGitRepoInfo(repoPath),
  })

  return {
    logger,
    quayToken,
    quayMockService,
    quayServiceHelper,
    quayNamespace,
    queue,
    repoPath,
    toActualPackageName: toActualName,
  }
}
