import { Logger, LogLevel } from '@era-ci/core'
import { listTags } from '@era-ci/image-registry-client'
import { CreateRepo, createTest, TestResources } from '@era-ci/e2e-tests-infra'
import { winstonLogger } from '@era-ci/loggers'
import { startQuayHelperService } from '@era-ci/quay-helper-service'
import { startQuayMockService } from '@era-ci/quay-mock-service'
import { QuayBuildsTaskQueue, quayBuildsTaskQueue } from '@era-ci/task-queues'
import { getGitRepoInfo } from '@era-ci/utils'
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
    listTags({
      registry: getResources().dockerRegistry,
      dockerOrg: testDependencies.quayNamespace,
      repo: testDependencies.toActualPackageName(packageName),
    })

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
    REDIS_ADDRESS: getResources().redisServerUrl,
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
    logFilePath: './era-ci.log',
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
    redis: {
      url: getResources().redisServerUrl,
    },
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
