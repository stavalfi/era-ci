import { CreateRepo, createTest, TestResources } from '@tahini/e2e-tests-infra'
import { getGitRepoInfo, Logger, LogLevel, winstonLogger } from '@tahini/nc'
import { startQuayHelperService } from '@tahini/quay-helper-service'
import { startQuayMockService } from '@tahini/quay-mock-service'
import { QuayBuildsTaskQueue, quayBuildsTaskQueue } from '@tahini/quay-task-queue'
import chance from 'chance'

type TestDependencies = {
  quayServiceHelper: { address: string; cleanup: () => Promise<unknown> }
  quayMockService: { address: string; cleanup: () => Promise<unknown> }
  quayNamespace: string
  quayToken: string
  repoPath: string
  logger: Logger
  queue: QuayBuildsTaskQueue
}

export function beforeAfterEach(): {
  getResoureces: () => {
    queue: QuayBuildsTaskQueue
  }
} {
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

  return {
    getResoureces: () => ({
      queue: testDependencies.queue,
    }),
  }
}

async function createTestDependencies(
  getResoureces: () => TestResources,
  createRepo: CreateRepo,
): Promise<TestDependencies> {
  const quayServiceHelper = await startQuayHelperService({
    PORT: '0',
    REDIS_ADDRESS: getResoureces().redisServerUri,
    QUAY_BUILD_STATUS_CHANED_TEST_REDIS_TOPIC: `redis-topic-${chance().hash()}`,
  })
  const quayNamespace = `namespace-${chance().hash()}`
  const quayToken = `token-${chance().hash()}`
  const quayMockService = await startQuayMockService({
    dockerRegistryAddress: getResoureces().dockerRegistry,
    namespace: quayNamespace,
    token: quayToken,
  })

  const { repoPath } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
      },
    ],
  })

  const logger = await winstonLogger({
    customLogLevel: LogLevel.verbose,
    disabled: false,
    logFilePath: './nc.log',
  }).callInitializeLogger({ repoPath })

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
    taskTimeoutMs: 5 * 1000,
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
  }
}
