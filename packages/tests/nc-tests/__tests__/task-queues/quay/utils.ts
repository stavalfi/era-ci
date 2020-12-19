import { Logger, LogLevel } from '@tahini/core'
import { CreateRepo, createTest, TestResources } from '@tahini/e2e-tests-infra'
import { winstonLogger } from '@tahini/loggers'
import { startQuayHelperService } from '@tahini/quay-helper-service'
import { startQuayMockService } from '@tahini/quay-mock-service'
import { getDockerImageLabelsAndTags } from '@tahini/steps'
import { QuayBuildsTaskQueue, quayBuildsTaskQueue } from '@tahini/task-queues'
import { getGitRepoInfo } from '@tahini/utils'
import chance from 'chance'
import _ from 'lodash'
import path from 'path'

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
export function beforeAfterEach(options?: {
  quayMockService?: {
    rateLimit?: {
      max: number
      timeWindowMs: number
    }
  }
}) {
  const { getResources, createRepo } = createTest()

  let testDependencies: TestDependencies

  beforeEach(async () => {
    testDependencies = await createTestDependencies(getResources, createRepo, options)
  })

  afterEach(async () => {
    await Promise.all([
      testDependencies.quayMockService.cleanup(),
      testDependencies.quayServiceHelper.cleanup(),
      testDependencies.queue.cleanup(),
    ])
  })

  const getImageTags = (packageName: string) =>
    getDockerImageLabelsAndTags({
      dockerOrganizationName: testDependencies.quayNamespace,
      imageName: testDependencies.toActualPackageName(packageName),
      dockerRegistry: getResources().dockerRegistry,
      repoPath: testDependencies.repoPath,
      log: testDependencies.logger.createLog('test'),
      silent: true,
    }).then(r => r?.allValidTagsSorted || [])

  return {
    getImageTags,
    getResources: () => {
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
            path: path.join(testDependencies.repoPath, 'packages', testDependencies.toActualPackageName(`package${i}`)),
          },
        ]),
      )
      return {
        quayNamespace: testDependencies.quayNamespace,
        queue: testDependencies.queue,
        repoPath: testDependencies.repoPath,
        packages,
      }
    },
  }
}

async function createTestDependencies(
  getResources: () => TestResources,
  createRepo: CreateRepo,
  options?: {
    quayMockService?: {
      rateLimit?: {
        max: number
        timeWindowMs: number
      }
    }
  },
): Promise<TestDependencies> {
  const redisTopic = `redis-topic-${chance().hash().slice(0, 8)}`
  const quayServiceHelper = await startQuayHelperService({
    PORT: '0',
    REDIS_ADDRESS: getResources().redisServerUri,
    QUAY_BUILD_STATUS_CHANED_TEST_REDIS_TOPIC: redisTopic,
    NC_TEST_MODE: 'true',
  })
  const quayNamespace = `namespace-${chance().hash().slice(0, 8)}`
  const quayToken = `token-${chance().hash().slice(0, 8)}`
  const quayMockService = await startQuayMockService({
    dockerRegistryAddress: getResources().dockerRegistry,
    namespace: quayNamespace,
    token: quayToken,
    rateLimit: options?.quayMockService?.rateLimit || { max: 1000, timeWindowMs: 1000 * 1000 },
  })

  const { repoPath, toActualName } = await createRepo({
    repo: {
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
    },
  })

  const logger = await winstonLogger({
    customLogLevel: LogLevel.trace,
    disabled: false,
    logFilePath: './nc.log',
  }).callInitializeLogger({ repoPath })

  // eslint-disable-next-line no-process-env
  process.env.QUAY_BUILD_STATUS_CHANED_TEST_REDIS_TOPIC = redisTopic

  const queue = await quayBuildsTaskQueue({
    getCommitTarGzPublicAddress: () =>
      `${quayServiceHelper.address}/download-git-repo-tar-gz?git_registry=local-filesystem&repo_abs_path=${repoPath}`,
    quayAddress: quayMockService.address,
    quayNamespace,
    quayServiceHelperAddress: quayServiceHelper.address,
    quayToken,
    redisAddress: getResources().redisServerUri,
  }).createFunc({
    log: logger.createLog('quayBuildsTaskQueue'),
    gitRepoInfo: await getGitRepoInfo(repoPath, logger.createLog('--')),
    logger,
    repoPath,
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
