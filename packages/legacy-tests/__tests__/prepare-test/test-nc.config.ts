import {
  build,
  cliTableReporter,
  config,
  createLinearStepsGraph,
  dockerPublish,
  install,
  jsonReporter,
  localSequentalTaskQueue,
  LogLevel,
  npmPublish,
  NpmScopeAccess,
  redisConnection,
  test,
  validatePackages,
  winstonLogger,
} from '@tahini/nc'

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
  REDIS_PASSWORD,
  TEST_SCRIPT_NAME,
  // eslint-disable-next-line no-process-env
} = process.env

const logger = winstonLogger({
  customLogLevel: LogLevel.verbose,
  disabled: false,
  logFilePath: './nc.log',
})

const keyValueStore = redisConnection({
  redisServer: REDIS_ENDPOINT!,
  auth: {
    password: REDIS_PASSWORD!,
  },
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

export default config({ taskQueues: [localSequentalTaskQueue.configure()], steps, keyValueStore, logger })
