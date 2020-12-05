import { config, LogLevel } from '@tahini/core'
import { createLinearStepsGraph } from '@tahini/steps-graph'
import { redisConnection } from '@tahini/key-value-stores'
import { localSequentalTaskQueue } from '@tahini/task-queues'
import { winstonLogger } from '@tahini/loggers'
import {
  build,
  cliTableReporter,
  dockerPublish,
  install,
  jsonReporter,
  npmPublish,
  NpmScopeAccess,
  validatePackages,
  test,
} from '@tahini/steps'

const {
  SHOULD_PUBLISH_NPM,
  SHOULD_PUBLISH_DOCKER,
  DOCKER_ORGANIZATION_NAME,
  DOCKER_REGISTRY,
  NPM_REGISTRY,
  NPM_EMAIL,
  NPM_USERNAME,
  NPM_TOKEN,
  DOCKER_HUB_USERNAME,
  DOCKER_HUB_TOKEN,
  REDIS_ENDPOINT,
  TEST_SCRIPT_NAME,
  // eslint-disable-next-line no-process-env
} = process.env

const logger = winstonLogger({
  customLogLevel: LogLevel.trace,
  disabled: false,
  logFilePath: './nc.log',
})

const keyValueStore = redisConnection({
  redisServerUri: REDIS_ENDPOINT!,
})

const steps = createLinearStepsGraph([
  validatePackages(),
  install(),
  build(),
  test({
    testScriptName: TEST_SCRIPT_NAME!,
  }),
  npmPublish({
    isStepEnabled: Boolean(SHOULD_PUBLISH_NPM),
    npmScopeAccess: NpmScopeAccess.public,
    registry: NPM_REGISTRY!,
    publishAuth: {
      email: NPM_EMAIL!,
      username: NPM_USERNAME!,
      token: NPM_TOKEN!,
    },
  }),
  dockerPublish({
    isStepEnabled: Boolean(SHOULD_PUBLISH_DOCKER),
    dockerOrganizationName: DOCKER_ORGANIZATION_NAME!,
    registry: DOCKER_REGISTRY!,
    registryAuth: {
      username: DOCKER_HUB_USERNAME!,
      token: DOCKER_HUB_TOKEN!,
    },
  }),
  jsonReporter(),
  cliTableReporter(),
])

export default config({ taskQueues: [localSequentalTaskQueue()], steps, keyValueStore, logger })
