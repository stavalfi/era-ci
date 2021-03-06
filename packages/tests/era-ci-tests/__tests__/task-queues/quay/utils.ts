import { connectToRedis, Logger } from '@era-ci/core'
import { CreateRepo, createTest, TestFuncs, TestResources } from '@era-ci/e2e-tests-infra'
import { listTags } from '@era-ci/image-registry-client'
import { startQuayMockService } from '@era-ci/quay-mock-service'
import { QuayBuildsTaskQueue, quayBuildsTaskQueue } from '@era-ci/task-queues'
import { distructPackageJsonName, getGitRepoInfo } from '@era-ci/utils'
import execa from 'execa'
import _ from 'lodash'
import path from 'path'
import { beforeEach } from '@jest/globals'

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
  repoName: string
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

type QuayTestResources = {
  repoName: string
  repoPath: string
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
  getCommitTarGzPublicAddress?: (options: {
    repoNameWithOrgName: string
    gitCommit: string
  }) => Promise<{
    url: string
    folderName: string
  }>
}): {
  getResources: () => QuayTestResources & TestResources
} {
  const testFuncs = createTest({
    startQuayHelperService: true,
    startQuayMockService: false,
  })

  let getResources: QuayTestResources

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
      repoName: taskQueuesResources.repoName,
      repoPath: taskQueuesResources.repoPath,
      taskQueuesResources,
      getImageTags: getImageTags1,
      packages,
    }
  })

  return { getResources: () => ({ ...getResources, ...testFuncs.getResources() }) }
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
    getCommitTarGzPublicAddress?: (options: {
      repoNameWithOrgName: string
      gitCommit: string
    }) => Promise<{
      url: string
      folderName: string
    }>
  },
): Promise<TestDependencies> {
  const quayMockService = await startQuayMockService({
    isTestMode: true,
    dockerRegistryAddress: testFuncs.getResources().dockerRegistry,
    namespace: testFuncs.getResources().quayNamespace,
    token: testFuncs.getResources().quayToken,
    rateLimit: options?.quayMockService?.rateLimit || { max: 1_000_000_000, timeWindowMs: 1_000_000_000 },
  })
  testFuncs.getCleanups().cleanups.push(quayMockService.cleanup)

  const { repoPath, repoName, toActualName } = await testFuncs.createRepo({
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

  const queue1 = quayBuildsTaskQueue({
    getCommitTarGzPublicAddress:
      options?.getCommitTarGzPublicAddress ??
      (async () => {
        const folderName = `${repoName}-${await execa
          .command(`git rev-parse HEAD`, { stdio: 'pipe', cwd: repoPath })
          .then(r => r.stdout.slice(0, 8))}`
        return {
          url: `${
            testFuncs.getResources().quayHelperService.address
          }/download-git-repo-tar-gz?git_registry=local-filesystem&repo_abs_path=${repoPath}`,
          folderName,
        }
      }),
    dockerRegistry: testFuncs.getResources().dockerRegistry,
    quayService: quayMockService.address,
    quayNamespace: testFuncs.getResources().quayNamespace,
    quayToken: testFuncs.getResources().quayToken,
    quayHelperServiceUrl: testFuncs.getResources().quayHelperService.address,
    redis: {
      url: testFuncs.getResources().redisServerUrl,
    },
  })
  const redisClient = await connectToRedis({
    config: {
      url: testFuncs.getResources().redisServerUrl,
    },
    logger,
  })
  testFuncs.getCleanups().connectionCleanups.push(redisClient.cleanup)

  const queue = await queue1.createFunc({
    redisClient,
    log: logger.createLog('quayBuildsTaskQueue'),
    gitRepoInfo: await getGitRepoInfo({ repoPath, log: logger.createLog('--') }),
    logger,
    repoPath,
    processEnv: {
      QUAY_BUILD_STATUS_CHANED_TEST_REDIS_TOPIC: testFuncs.getProcessEnv().QUAY_BUILD_STATUS_CHANED_TEST_REDIS_TOPIC,
    },
  })
  testFuncs.getCleanups().cleanups.push(queue.cleanup)

  return {
    logger,
    quayMockService,
    queue,
    repoPath,
    repoName,
    toActualPackageName: toActualName,
  }
}
