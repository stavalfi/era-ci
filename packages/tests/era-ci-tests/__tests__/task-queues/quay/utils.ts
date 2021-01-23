import { Logger } from '@era-ci/core'
import { CreateRepo, createTest, TestFuncs } from '@era-ci/e2e-tests-infra'
import { listTags } from '@era-ci/image-registry-client'
import { startQuayMockService } from '@era-ci/quay-mock-service'
import { QuayBuildsTaskQueue, quayBuildsTaskQueue } from '@era-ci/task-queues'
import { distructPackageJsonName, getGitRepoInfo } from '@era-ci/utils'
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

type TestDependencies = {
  quayMockService: { address: string; cleanup: () => Promise<unknown> }
  repoPath: string
  logger: Logger
  queue: QuayBuildsTaskQueue
  toActualPackageName: (packageName: string) => string
}

const getImageTags = ({
  getResources,
  toActualPackageName,
}: TestFuncs & { createRepo: CreateRepo } & TestDependencies) => (packageName: string) =>
  listTags({
    registry: getResources().dockerRegistry,
    dockerOrg: getResources().quayNamespace,
    repo: distructPackageJsonName(toActualPackageName(packageName)).name,
  })

type TestResources = {
  taskQueuesResources: TestDependencies
  getImageTags: (packageName: string) => Promise<string[]>
  packages: {
    [k: string]: {
      name: string
      relativeDockerFilePath: string
      path: string
    }
  }
}

export function beforeAfterEach(options?: {
  quayMockService?: {
    rateLimit?: {
      max: number
      timeWindowMs: number
    }
  }
}): {
  getResources: () => TestResources
} {
  const testFuncs = createTest()

  let getResources: TestResources

  beforeEach(async () => {
    const taskQueuesResources = await createTestDependencies(testFuncs, options)
    const getImageTags1 = getImageTags({ ...testFuncs, ...taskQueuesResources })
    const packages = Object.fromEntries(
      _.range(0, 15).map(i => [
        `package${i}`,
        {
          name: taskQueuesResources.toActualPackageName(`package${i}`),
          relativeDockerFilePath: path.join(
            '/',
            'packages',
            taskQueuesResources.toActualPackageName(`package${i}`),
            'Dockerfile',
          ),
          path: path.join(
            taskQueuesResources.repoPath,
            'packages',
            taskQueuesResources.toActualPackageName(`package${i}`),
          ),
        },
      ]),
    )
    getResources = {
      taskQueuesResources,
      getImageTags: getImageTags1,
      packages,
    }
  })

  return { getResources: () => getResources }
}

async function createTestDependencies(
  testFuncs: TestFuncs & { createRepo: CreateRepo },
  options?: {
    quayMockService?: {
      rateLimit?: {
        max: number
        timeWindowMs: number
      }
    }
  },
): Promise<TestDependencies> {
  const quayMockService = await startQuayMockService({
    dockerRegistryAddress: testFuncs.getResources().dockerRegistry,
    namespace: testFuncs.getResources().quayNamespace,
    token: testFuncs.getResources().quayToken,
    rateLimit: options?.quayMockService?.rateLimit || { max: 1000, timeWindowMs: 1000 * 1000 },
    // eslint-disable-next-line no-console
    customLog: console.log.bind(console),
  })
  testFuncs.getCleanups().push(quayMockService.cleanup)

  const { repoPath, toActualName } = await testFuncs.createRepo({
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

  const logger = await testFuncs.createTestLogger(repoPath)

  const queue = await quayBuildsTaskQueue({
    getCommitTarGzPublicAddress: () =>
      `${
        testFuncs.getResources().quayHelperService.address
      }/download-git-repo-tar-gz?git_registry=local-filesystem&repo_abs_path=${repoPath}`,
    quayAddress: quayMockService.address,
    quayNamespace: testFuncs.getResources().quayNamespace,
    quayToken: testFuncs.getResources().quayToken,
    quayServiceHelperAddress: testFuncs.getResources().quayHelperService.address,
    redis: {
      url: testFuncs.getResources().redisServerUrl,
    },
  }).createFunc({
    log: logger.createLog('quayBuildsTaskQueue'),
    gitRepoInfo: await getGitRepoInfo(repoPath, logger.createLog('--')),
    logger,
    repoPath,
    processEnv: {
      QUAY_BUILD_STATUS_CHANED_TEST_REDIS_TOPIC: testFuncs.getProcessEnv().QUAY_BUILD_STATUS_CHANED_TEST_REDIS_TOPIC,
    },
  })
  testFuncs.getCleanups().push(queue.cleanup)

  return {
    logger,
    quayMockService,
    queue,
    repoPath,
    toActualPackageName: toActualName,
  }
}
