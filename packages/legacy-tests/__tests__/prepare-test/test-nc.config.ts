import {
  build,
  cliTableReporter,
  Config,
  createLinearStepsGraph,
  dockerPublish,
  install,
  jsonReporter,
  lint,
  LogLevel,
  npmPublish,
  NpmScopeAccess,
  redisWithNodeCache,
  test,
  validatePackages,
  winstonLogger,
} from '@tahini/nc'

export default async (): Promise<Config> => {
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

  const cache = redisWithNodeCache({
    redis: {
      redisServer: REDIS_ENDPOINT!,
      auth: {
        password: REDIS_PASSWORD!,
      },
    },
  })

  const steps = createLinearStepsGraph([
    validatePackages(),
    install(),
    lint(),
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

  return {
    steps,
    cache,
    logger,
  }
}
