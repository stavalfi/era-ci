import { config, LogLevel } from './packages/core/dist/src/index'
import { winstonLogger } from './packages/loggers/dist/src/index'
import { createTreeStepsGraph } from './packages/steps-graph/dist/src/index'
import {
  installRoot,
  buildRoot,
  cliTableReporter,
  jsonReporter,
  lintRoot,
  npmPublish,
  NpmScopeAccess,
  test,
  validatePackages,
  quayDockerPublish,
} from './packages/steps/dist/src/index'
import {
  localSequentalTaskQueue,
  taskWorkerTaskQueue,
  quayBuildsTaskQueue,
} from './packages/task-queues/dist/src/index'
import chance from 'chance'

const {
  NPM_REGISTRY = 'http://localhost:34873',
  NPM_USERNAME = 'username',
  NPM_PASSWORD = 'password',
  NPM_EMAIL = 'any@email.com',
  QUAY_REGISTRY = `http://localhost:35000`,
  QUAY_SERVICE = `http://localhost:9001`,
  QUAY_ORG = 'org1',
  QUAY_ORG_TOKEN = 'token1',
  QUAY_USERNAME,
  QUAY_USERNAME_TOKEN,
  QUAY_HELPER_SERVICE_URL = 'http://localhost:9000',
  REDIS_ENDPOINT = 'redis://localhost:36379',
  REDIS_PASSWORD,
  GITHUB_RUN_NUMBER = chance().hash().slice(0, 8),
  CI,
  LOG_LEVEL = LogLevel.info,
  SKIP_TESTS,
  // eslint-disable-next-line no-process-env
} = process.env

export default config({
  taskQueues: [
    quayBuildsTaskQueue({
      getCommitTarGzPublicAddress: async ({ gitCommit }: { gitCommit: string }) => ({
        url: `https://api.github.com/repos/stavalfi/era-ci/tarball/${gitCommit}`,
        folderName: `stavalfi-era-ci-${gitCommit.slice(0, 7)}`,
      }),
      quayService: QUAY_SERVICE,
      dockerRegistry: QUAY_REGISTRY,
      quayNamespace: QUAY_ORG,
      quayToken: QUAY_ORG_TOKEN,
      quayHelperServiceUrl: QUAY_HELPER_SERVICE_URL,
      redis: {
        url: REDIS_ENDPOINT!,
        auth: {
          password: REDIS_PASSWORD,
        },
      },
    }),
    taskWorkerTaskQueue({
      queueName: `queue-${GITHUB_RUN_NUMBER}`,
      redis: {
        url: REDIS_ENDPOINT!,
        auth: {
          password: REDIS_PASSWORD,
        },
      },
    }),
    localSequentalTaskQueue(),
  ],
  redis: {
    url: REDIS_ENDPOINT!,
    auth: {
      password: REDIS_PASSWORD,
    },
  },
  logger: winstonLogger({
    disabled: false,
    customLogLevel: LOG_LEVEL as LogLevel,
    logFilePath: './era-ci.log',
  }),
  steps: createTreeStepsGraph([
    {
      // 0
      step: validatePackages(),
      children: [1],
    },
    {
      // 1
      step: installRoot({ isStepEnabled: true }),
      children: [2, 3, 4, 5, 6],
    },
    {
      // 2
      step: lintRoot({ isStepEnabled: true, scriptName: 'lint:code' }),
      children: [7],
    },
    {
      // 3
      step: buildRoot({ isStepEnabled: true, scriptName: 'build' }),
      children: [6],
    },
    {
      // 4
      step: test({
        isStepEnabled: !SKIP_TESTS,
        scriptName: 'test',
        workerBeforeAll: CI
          ? {
              // for some reason, sometimes, github gives us VMs which are already used and has the containers still
              // running from previous build, so we use test-resources:reset to kill any leftovers from previous builds.
              shellCommand: 'yarn all-resources:reset',
              cwd: __dirname,
            }
          : undefined,
        splitTestsToMultipleVms: {
          totalWorkers: 10,
          relativeGlobToSearchTestFiles: '__tests__/**/*.spec.ts',
          startIndexingFromZero: true,
          env: {
            indexKeyEnvName: 'CI_NODE_INDEX',
            totalVmsEnvKeyName: 'CI_NODE_TOTAL',
          },
        },
      }),
      children: [6],
    },
    {
      // 5
      step: quayDockerPublish({
        isStepEnabled: !CI,
        dockerfileBuildTimeoutMs: 200_000,
        imagesVisibility: 'public',
        dockerOrganizationName: QUAY_ORG,
        dockerRegistry: QUAY_REGISTRY,
        quayService: QUAY_SERVICE,
        dockerRegistryAuth: {
          username: QUAY_USERNAME!,
          token: QUAY_USERNAME_TOKEN!,
        },
      }),
      children: [7],
    },
    {
      // 6
      step: npmPublish({
        isStepEnabled: !CI,
        npmScopeAccess: NpmScopeAccess.public,
        registry: NPM_REGISTRY,
        registryAuth: {
          email: NPM_EMAIL,
          username: NPM_USERNAME!,
          password: NPM_PASSWORD!,
        },
      }),
      children: [7],
    },
    {
      // 7
      step: jsonReporter(),
      children: [8],
    },
    {
      // 8
      step: cliTableReporter(),
      children: [],
    },
  ]),
})
