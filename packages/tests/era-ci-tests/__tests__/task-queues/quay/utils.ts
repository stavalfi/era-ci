import { Logger, LogLevel } from '@era-ci/core'
import { createRepo, CreateRepo, createTest, TestWithContextType } from '@era-ci/e2e-tests-infra'
import { listTags } from '@era-ci/image-registry-client'
import { winstonLogger } from '@era-ci/loggers'
import { startQuayHelperService } from '@era-ci/quay-helper-service'
import { startQuayMockService } from '@era-ci/quay-mock-service'
import { QuayBuildsTaskQueue, quayBuildsTaskQueue } from '@era-ci/task-queues'
import { distructPackageJsonName, getGitRepoInfo } from '@era-ci/utils'
import anyTest, { ExecutionContext, TestInterface } from 'ava'
import chance from 'chance'
import _ from 'lodash'
import path from 'path'

export type ContextType = {
  taskQueuesResources: TestDependencies
  getImageTags: (packageName: string) => Promise<string[]>
  packages: {
    [packageName: string]: {
      name: string
      relativeDockerFilePath: string
      path: string
    }
  }
}

export const test = anyTest as TestInterface<ContextType & TestWithContextType>

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

const getImageTags = (t: ExecutionContext<ContextType & TestWithContextType>) => (packageName: string) =>
  listTags({
    registry: t.context.resources.dockerRegistry,
    dockerOrg: t.context.taskQueuesResources.quayNamespace,
    repo: distructPackageJsonName(t.context.taskQueuesResources.toActualPackageName(packageName)).name,
  })

export function beforeAfterEach(
  test: TestInterface<ContextType & TestWithContextType>,
  options?: {
    quayMockService?: {
      rateLimit?: {
        max: number
        timeWindowMs: number
      }
    }
  },
) {
  createTest(test)

  test.serial.beforeEach(async t => {
    t.context.taskQueuesResources = await createTestDependencies(t, createRepo, options)
    t.context.getImageTags = getImageTags(t)
    t.context.packages = Object.fromEntries(
      _.range(0, 15).map(i => [
        `package${i}`,
        {
          name: t.context.taskQueuesResources.toActualPackageName(`package${i}`),
          relativeDockerFilePath: path.join(
            '/',
            'packages',
            t.context.taskQueuesResources.toActualPackageName(`package${i}`),
            'Dockerfile',
          ),
          path: path.join(
            t.context.taskQueuesResources.repoPath,
            'packages',
            t.context.taskQueuesResources.toActualPackageName(`package${i}`),
          ),
        },
      ]),
    )
  })

  test.serial.afterEach(async t => {
    await Promise.all([
      t.context.taskQueuesResources.quayMockService.cleanup(),
      t.context.taskQueuesResources.quayServiceHelper.cleanup(),
      t.context.taskQueuesResources.queue.cleanup(),
    ])
  })
}

async function createTestDependencies(
  t: ExecutionContext<ContextType & TestWithContextType>,
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
    REDIS_ADDRESS: t.context.resources.redisServerUrl,
    QUAY_BUILD_STATUS_CHANED_TEST_REDIS_TOPIC: redisTopic,
    NC_TEST_MODE: 'true',
  })
  const quayNamespace = `namespace-${chance().hash().slice(0, 8)}`
  const quayToken = `token-${chance().hash().slice(0, 8)}`
  const quayMockService = await startQuayMockService({
    dockerRegistryAddress: t.context.resources.dockerRegistry,
    namespace: quayNamespace,
    token: quayToken,
    rateLimit: options?.quayMockService?.rateLimit || { max: 1000, timeWindowMs: 1000 * 1000 },
    customLog: t.log.bind(t),
  })

  const { repoPath, toActualName } = await createRepo(t, {
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
  }).callInitializeLogger({ repoPath, customLog: { customLog: t.log.bind(t), transformer: x => `${t.title} - ${x}` } })

  const queue = await quayBuildsTaskQueue({
    getCommitTarGzPublicAddress: () =>
      `${quayServiceHelper.address}/download-git-repo-tar-gz?git_registry=local-filesystem&repo_abs_path=${repoPath}`,
    quayAddress: quayMockService.address,
    quayNamespace,
    quayServiceHelperAddress: quayServiceHelper.address,
    quayToken,
    redis: {
      url: t.context.resources.redisServerUrl,
    },
  }).createFunc({
    log: logger.createLog('quayBuildsTaskQueue'),
    gitRepoInfo: await getGitRepoInfo(repoPath, logger.createLog('--')),
    logger,
    repoPath,
    processEnv: {
      QUAY_BUILD_STATUS_CHANED_TEST_REDIS_TOPIC: redisTopic,
    },
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
