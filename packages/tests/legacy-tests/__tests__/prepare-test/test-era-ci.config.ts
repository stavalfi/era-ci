import { config, LogLevel } from '@era-ci/core'
import { winstonLogger } from '@era-ci/loggers'
import {
  buildRoot,
  cliTableReporter,
  dockerPublish,
  installRoot,
  jsonReporter,
  npmPublish,
  NpmScopeAccess,
  test,
  validatePackages,
} from '@era-ci/steps'
import { createLinearStepsGraph } from '@era-ci/steps-graph'
import { localSequentalTaskQueue, taskWorkerTaskQueue } from '@era-ci/task-queues'
import chance from 'chance'
import colors from 'colors/safe'

const {
  SHOULD_PUBLISH_NPM,
  SHOULD_PUBLISH_DOCKER,
  DOCKER_ORGANIZATION_NAME,
  DOCKER_REGISTRY,
  NPM_REGISTRY,
  NPM_EMAIL,
  NPM_USERNAME,
  NPM_PASSWORD,
  REDIS_ENDPOINT,
  TEST_SCRIPT_NAME,
  // eslint-disable-next-line no-process-env
} = process.env

const logger = winstonLogger({
  customLogLevel: LogLevel.trace,
  disabled: false,
  logFilePath: './era-ci.log',
})

const steps = createLinearStepsGraph([
  validatePackages(),
  installRoot({ isStepEnabled: true }),
  buildRoot({ isStepEnabled: true, scriptName: 'build' }),
  test({
    isStepEnabled: true,
    scriptName: TEST_SCRIPT_NAME!,
  }),
  npmPublish({
    isStepEnabled: Boolean(SHOULD_PUBLISH_NPM),
    npmScopeAccess: NpmScopeAccess.public,
    registry: NPM_REGISTRY!,
    registryAuth: {
      email: NPM_EMAIL!,
      username: NPM_USERNAME!,
      password: NPM_PASSWORD!,
    },
  }),
  dockerPublish({
    isStepEnabled: Boolean(SHOULD_PUBLISH_DOCKER),
    dockerOrganizationName: DOCKER_ORGANIZATION_NAME!,
    dockerRegistry: DOCKER_REGISTRY!,
  }),
  jsonReporter(),
  cliTableReporter({ colorizeTable: s => colors.white(s) }),
])

export default config({
  taskQueues: [
    localSequentalTaskQueue(),
    taskWorkerTaskQueue({
      queueName: `queue-${chance().hash().slice(0, 8)}`,
      redis: {
        url: REDIS_ENDPOINT!,
      },
    }),
  ],
  steps,
  redis: {
    url: REDIS_ENDPOINT!,
  },
  logger,
})
