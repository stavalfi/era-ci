import {
  build,
  cliTableReporter,
  Config,
  dockerPublish,
  install,
  JsonReport,
  jsonReporter,
  lint,
  LogLevel,
  npmPublish,
  NpmScopeAccess,
  redisWithNodeCache,
  test,
  validatePackages,
  winstonLogger,
  createLinearStepsGraph,
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

  const fullImageNameCacheKey = ({ packageHash }: { packageHash: string }) =>
    `full_image_name_of_artifact_hash-${packageHash}`

  const jsonReporterCacheKey = ({ flowId, stepId }: { flowId: string; stepId: string }) =>
    `json-report-cache-key-${flowId}-${stepId}`

  const jsonReportToString = ({ jsonReport }: { jsonReport: JsonReport }) => JSON.stringify(jsonReport)

  const stringToJsonReport = ({ jsonReportAsString }: { jsonReportAsString: string }) =>
    JSON.parse(jsonReportAsString) as JsonReport

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
    install(),
    validatePackages(),
    lint(),
    build(),
    test({
      testScriptName: TEST_SCRIPT_NAME!,
    }),
    npmPublish({
      shouldPublish: Boolean(SHOULD_PUBLISH_NPM),
      npmScopeAccess: NpmScopeAccess.public,
      registry: NPM_REGISTRY!,
      publishAuth: {
        email: NPM_EMAIL!,
        username: NPM_USERNAME!,
        token: NPM_TOKEN!,
      },
    }),
    dockerPublish({
      shouldPublish: Boolean(SHOULD_PUBLISH_DOCKER),
      dockerOrganizationName: DOCKER_ORGANIZATION_NAME!,
      registry: DOCKER_REGISTRY!,
      registryAuth: {
        username: DOCKER_HUB_USERNAME!,
        token: DOCKER_HUB_TOKEN!,
      },
      fullImageNameCacheKey,
    }),
    jsonReporter({
      jsonReporterCacheKey,
      jsonReportToString,
    }),
    cliTableReporter({
      jsonReporterCacheKey,
      stringToJsonReport,
    }),
  ])

  return {
    steps,
    cache,
    logger,
  }
}
