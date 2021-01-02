import ciInfo from 'ci-info'
import { config, LogLevel } from './packages/core/dist/src/index'
import { redisConnection } from './packages/key-value-stores/dist/src/index'
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
import { localSequentalTaskQueue } from './packages/task-queues/dist/src/index'
import { execaCommand } from './packages/utils/dist/src/index'

const {
  NPM_REGISTRY = 'https://registry.npmjs.org/',
  NPM_USERNAME,
  NPM_TOKEN,
  NPM_EMAIL = 'stavalfi@gmail.com',
  DOCKER_HUB_USERNAME,
  DOCKER_HUB_TOKEN,
  DOCKER_ORG = 'stavalfi',
  DOCKER_REGISTRY = `https://registry.hub.docker.com/`,
  REDIS_ENDPOINT,
  REDIS_ACL_USERNAME,
  REDIS_ACL_PASSWORD,
  // REDIS_PASSWORD,
  // eslint-disable-next-line no-process-env
} = process.env

const isMasterBuild = Boolean(ciInfo.isCI && !ciInfo.isPR)

export default config({
  taskQueues: [localSequentalTaskQueue()],
  keyValueStore: redisConnection({
    url: REDIS_ENDPOINT!,
    auth: {
      username: REDIS_ACL_USERNAME,
      password: REDIS_ACL_PASSWORD,
    },
  }),
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
    // test({
    //   scriptName: 'test',
    //   beforeAll: ({ log, repoPath }) =>
    //     execaCommand(`yarn test-resources:up`, { cwd: repoPath, log, stdio: 'inherit' }),
    // }),
    // testUsingTaskWorker({
    //   queueName: '1',
    //   scriptName: 'test',
    //   redis: {
    //     url: REDIS_ENDPOINT!,
    //     auth: {
    //       password: REDIS_PASSWORD,
    //     },
    //   },
    //   beforeAll: ({ log, repoPath }) =>
    //     execaCommand(`yarn test-resources:up`, { cwd: repoPath, log, stdio: 'inherit' }),
    // }),
    npmPublish({
      isStepEnabled: isMasterBuild,
      npmScopeAccess: NpmScopeAccess.public,
      registry: NPM_REGISTRY,
      publishAuth: {
        email: NPM_EMAIL,
        username: NPM_USERNAME!,
        token: NPM_TOKEN!,
      },
    }),
    dockerPublish({
      isStepEnabled: false,
      dockerOrganizationName: DOCKER_ORG,
      registry: DOCKER_REGISTRY,
      registryAuth: {
        username: DOCKER_HUB_USERNAME!,
        token: DOCKER_HUB_TOKEN!,
      },
      buildAndPushOnlyTempVersion: !isMasterBuild,
    }),
    jsonReporter(),
    cliTableReporter(),
  ]),
})
