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

const {
  NPM_REGISTRY = 'http://localhost:34873',
  NPM_USERNAME = 'root',
  NPM_TOKEN = 'root',
  NPM_EMAIL = 'root@root.root',
  QUAY_REGISTRY = `http://localhost:9876`,
  QUAY_ORG = 'org1',
  QUAY_ORG_TOKEN = 'fake-mock-quay-token',
  QUAY_USERNAME,
  QUAY_USERNAME_TOKEN,
  QUAY_HELPER_SERVICE_URL = 'http://localhost:9875',
  REDIS_ENDPOINT = 'redis://localhost:36379',
  REDIS_PASSWORD,
  GITHUB_RUN_NUMBER = 'local-run',
  CI,
  LOG_LEVEL = LogLevel.info,
  // eslint-disable-next-line no-process-env
} = process.env

export default config({
  taskQueues: [
    quayBuildsTaskQueue({
      getCommitTarGzPublicAddress: async ({ gitCommit }: { gitCommit: string }) => ({
        url: `https://api.github.com/repos/stavalfi/era-ci/tarball/${gitCommit}`,
        folderName: `stavalfi-era-ci-${gitCommit.slice(0, 7)}`,
      }),
      quayAddress: QUAY_REGISTRY,
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
    localSequentalTaskQueue(),
    taskWorkerTaskQueue({
      queueName: `queue-${GITHUB_RUN_NUMBER}`,
      redis: {
        url: REDIS_ENDPOINT!,
        auth: {
          password: REDIS_PASSWORD,
        },
      },
    }),
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
      children: [6],
    },
    {
      // 1
      step: installRoot({ isStepEnabled: true }),
      children: [6],
    },
    {
      // 2
      step: lintRoot({ isStepEnabled: true, scriptName: 'lint:code' }),
      children: [6],
    },
    {
      // 3
      step: buildRoot({ isStepEnabled: true, scriptName: 'build' }),
      children: [6],
    },
    {
      // 4
      step: test({
        isStepEnabled: true,
        scriptName: 'test',
        workerBeforeAll: {
          shellCommand: 'yarn test-resources:up',
          cwd: __dirname,
        },
        splitTestsToMultipleVms: {
          totalWorkers: 10,
          relativeGlobToSearchTestFiles: '__tests__/**/*.spec.ts',
          startIndexingFromZero: true, // ava assume that the indexing starts from zero
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
        registry: QUAY_REGISTRY,
        registryAuth: {
          username: QUAY_USERNAME!,
          token: QUAY_USERNAME_TOKEN!,
        },
      }),
      children: [6],
    },
    {
      // 6
      step: npmPublish({
        isStepEnabled: true && !CI,
        npmScopeAccess: NpmScopeAccess.public,
        registry: NPM_REGISTRY,
        publishAuth: {
          email: NPM_EMAIL,
          username: NPM_USERNAME!,
          token: NPM_TOKEN!,
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
