import ciInfo from 'ci-info'
import _ from 'lodash'
import {
  build,
  cliTableReporter,
  Config,
  createLinearStepsGraph,
  dockerPublish,
  install,
  jsonReporter,
  k8sGcloudDeployment,
  lint,
  LogLevel,
  npmPublish,
  NpmScopeAccess,
  immutableRedisWithNodeCache,
  test,
  validatePackages,
  winstonLogger,
} from '.'

export default async (): Promise<Config> => {
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

  return {
    cache: immutableRedisWithNodeCache({
      redis: {
        redisServer: `redis://${REDIS_ENDPOINT}/`,
        auth: {
          password: REDIS_PASSWORD!,
        },
      },
    }),
    logger: winstonLogger({
      customLogLevel: LogLevel.verbose,
      disabled: false,
      logFilePath: './nc.log',
    }),
    steps: createLinearStepsGraph([
      install(),
      validatePackages(),
      lint(),
      build(),
      test({
        testScriptName: 'test',
      }),
      npmPublish({
        isStepEnabled: isMasterBuild,
        npmScopeAccess: NpmScopeAccess.public,
        registry: `https://registry.npmjs.org/`,
        publishAuth: {
          email: 'stavalfi@gmail.com',
          username: NPM_USERNAME!,
          token: NPM_TOKEN!,
        },
      }),
      dockerPublish({
        isStepEnabled: isMasterBuild,
        dockerOrganizationName: 'stavalfi',
        registry: `https://registry.hub.docker.com/`,
        registryAuth: {
          username: DOCKER_HUB_USERNAME!,
          token: DOCKER_HUB_TOKEN!,
        },
      }),
      k8sGcloudDeployment({
        isStepEnabled: isMasterBuild,
        gcloudProjectId: `dancer-staging-new`,
        k8sClusterName: `c-jxh57`,
        k8sClusterTokenBase64: K8S_CLUSTER_TOKEN!,
        k8sClusterZoneName: `europe-west3-c`,
        artifactNameToContainerName: _.identity,
        artifactNameToDeploymentName: _.identity,
      }),
      jsonReporter(),
      cliTableReporter(),
    ]),
  }
}
