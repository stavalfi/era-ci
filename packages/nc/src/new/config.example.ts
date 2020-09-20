import ciInfo from 'ci-info'
import _ from 'lodash'
import { LogLevel } from './create-logger'
import { redisWithNodeCache } from './redis-with-node-cache'
import {
  build,
  cliTableReport,
  dockerPublish,
  install,
  jsonReport,
  JsonReport,
  k8sGcloudDeployment,
  lint,
  npmPublish,
  NpmScopeAccess,
  test,
  validatePackages,
} from './steps'
import { ConfigFile, Step } from './types'
import { winstonLogger } from './winston-logger'

export default async (): Promise<ConfigFile> => {
  const {
    NPM_USERNAME,
    NPM_TOKEN,
    DOCKER_HUB_USERNAME,
    DOCKER_HUB_TOKEN,
    K8S_CLUSTER_TOKEN,
    REDIS_ENDPOINT,
    REDIS_PASSWORD,
    // eslint-disable-next-line no-process-env
  } = process.env

  const isMasterBuild = Boolean(ciInfo.isCI && !ciInfo.isPR)

  const fullImageNameCacheKey = ({ packageHash }: { packageHash: string }) =>
    `full_image_name_of_artifact_hash-${packageHash}`

  const jsonReportCacheKey = ({ flowId, stepId }: { flowId: string; stepId: string }) =>
    `json-report-cache-key-${flowId}-${stepId}`

  const jsonReportToString = ({ jsonReport }: { jsonReport: JsonReport }) => JSON.stringify(jsonReport)

  const stringToJsonReport = ({ jsonReportAsString }: { jsonReportAsString: string }) =>
    JSON.parse(jsonReportAsString) as JsonReport

  const logger = winstonLogger({
    customLogLevel: LogLevel.verbose,
    disable: false,
  })

  const cache = redisWithNodeCache({
    redis: {
      redisServer: `redis://${REDIS_ENDPOINT}/`,
      auth: {
        password: REDIS_PASSWORD!,
      },
    },
  })

  const steps: Step[] = [
    install(),
    validatePackages(),
    lint(),
    build(),
    test({
      testScriptName: 'test',
    }),
    npmPublish({
      shouldPublish: isMasterBuild,
      npmScopeAccess: NpmScopeAccess.public,
      registry: `https://registry.npmjs.org/`,
      publishAuth: {
        email: 'stavalfi@gmail.com',
        username: NPM_USERNAME!,
        token: NPM_TOKEN!,
      },
    }),
    dockerPublish({
      shouldPublish: isMasterBuild,
      dockerOrganizationName: 'stavalfi',
      registry: `https://registry.hub.docker.com/`,
      publishAuth: {
        username: DOCKER_HUB_USERNAME!,
        token: DOCKER_HUB_TOKEN!,
      },
      fullImageNameCacheKey,
    }),
    k8sGcloudDeployment({
      shouldDeploy: isMasterBuild,
      gcloudProjectId: `dancer-staging-new`,
      k8sClusterName: `c-jxh57`,
      k8sClusterTokenBase64: K8S_CLUSTER_TOKEN!,
      k8sClusterZoneName: `europe-west3-c`,
      fullImageNameCacheKey,
      artifactNameToContainerName: _.identity,
      artifactNameToDeploymentName: _.identity,
    }),
    jsonReport({
      jsonReportCacheKey,
      jsonReportToString,
    }),
    cliTableReport({
      jsonReportCacheKey,
      stringToJsonReport,
    }),
  ]

  return {
    steps,
    cache,
    logger,
  }
}
