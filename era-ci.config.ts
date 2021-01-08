import { config, LogLevel } from './packages/core/dist/src/index'
import { winstonLogger } from './packages/loggers/dist/src/index'
import { createLinearStepsGraph } from './packages/steps-graph/dist/src/index'
import {
  buildRoot,
  cliTableReporter,
  dockerPublish,
  installRoot,
  jsonReporter,
  lintRoot,
  npmPublish,
  NpmScopeAccess,
  test,
  validatePackages,
} from './packages/steps/dist/src/index'
import { localSequentalTaskQueue, taskWorkerTaskQueue } from './packages/task-queues/dist/src/index'
import { execaCommand } from './packages/utils/dist/src/index'

const {
  NPM_REGISTRY = 'http://localhost:34873/',
  NPM_USERNAME = 'root',
  NPM_TOKEN = 'root',
  NPM_EMAIL = 'root@root.root',
  DOCKER_HUB_USERNAME,
  DOCKER_HUB_TOKEN,
  DOCKER_ORG = 'local-run-org',
  DOCKER_REGISTRY = `http://localhost:35000`,
  REDIS_ENDPOINT = 'redis://localhost:36379',
  REDIS_ACL_USERNAME,
  REDIS_ACL_PASSWORD,
  REDIS_PASSWORD,
  GITHUB_RUN_NUMBER = 'local-run',
  CI = 'false',
  // eslint-disable-next-line no-process-env
} = process.env

export default config({
  taskQueues: [
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
      username: REDIS_ACL_USERNAME,
      password: REDIS_ACL_PASSWORD,
    },
  },
  logger: winstonLogger({
    disabled: false,
    customLogLevel: LogLevel.info,
    logFilePath: './era-ci.log',
  }),
  steps: createLinearStepsGraph([
    validatePackages(),
    installRoot(),
    lintRoot({ scriptName: 'lint:code' }),
    buildRoot({ scriptName: 'build' }),
    test({
      scriptName: 'test',
      beforeAll: async ({ log, repoPath }) =>
        CI === 'true' && execaCommand(`yarn test-resources:up`, { cwd: repoPath, log, stdio: 'inherit' }),
      afterAll: async ({ log, repoPath }) =>
        CI === 'true' && execaCommand(`yarn test-resources:down`, { cwd: repoPath, log, stdio: 'inherit' }),
    }),
    npmPublish({
      isStepEnabled: CI === 'false',
      npmScopeAccess: NpmScopeAccess.public,
      registry: NPM_REGISTRY,
      publishAuth: {
        email: NPM_EMAIL,
        username: NPM_USERNAME!,
        token: NPM_TOKEN!,
      },
    }),
    // dockerPublish({
    //   isStepEnabled: CI === 'false',
    //   dockerOrganizationName: DOCKER_ORG,
    //   registry: DOCKER_REGISTRY,
    //   registryAuth: {
    //     username: DOCKER_HUB_USERNAME!,
    //     token: DOCKER_HUB_TOKEN!,
    //   },
    //   buildAndPushOnlyTempVersion: false,
    // }),
    jsonReporter(),
    cliTableReporter(),
  ]),
})
