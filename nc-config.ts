import ciInfo from 'ci-info'
import _ from 'lodash'
import {
  build,
  cliTableReporter,
  Config,
  createLinearStepsGraph,
  dockerPublish,
  execaCommand,
  redisConnection,
  install,
  jsonReporter,
  k8sGcloudDeployment,
  lint,
  LogLevel,
  npmPublish,
  NpmScopeAccess,
  test,
  validatePackages,
  winstonLogger,
} from './packages/nc'

export default async (): Promise<Config> => {
  const {
    NPM_REGISTRY = 'https://registry.npmjs.org/',
    NPM_USERNAME,
    NPM_TOKEN,
    NPM_EMAIL = 'stavalfi@gmail.com',
    DOCKER_HUB_USERNAME,
    DOCKER_HUB_TOKEN,
    DOCKER_ORG = 'stavalfi',
    DOCKER_REGISTRY = `https://registry.hub.docker.com/`,
    K8S_CLUSTER_TOKEN,
    REDIS_ENDPOINT,
    REDIS_PASSWORD,
    GCLOUD_PROJECT_ID = 'gcloudProjectId',
    K8S_CLUSTER_NAME = `c-jxh57`,
    K8S_CLUSTER_ZONE_NAME = `europe-west3-c`,
    // eslint-disable-next-line no-process-env
  } = process.env

  const isMasterBuild = Boolean(ciInfo.isCI && !ciInfo.isPR)

  return {
    keyValueStore: redisConnection({
      redisServer: `redis://${REDIS_ENDPOINT}/`,
      auth: {
        password: REDIS_PASSWORD!,
      },
    }),
    logger: winstonLogger({
      customLogLevel: LogLevel.verbose,
      disabled: false,
      logFilePath: './nc.log',
    }),
    steps: createLinearStepsGraph([
      validatePackages(),
      install(),
      lint({ lintScriptName: 'lint:code' }),
      build(),
      test({
        testScriptName: 'test',
        beforeAll: ({ log, repoPath }) =>
          execaCommand(`yarn test-resources:up`, { cwd: repoPath, log, stdio: 'inherit' }),
      }),
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
      }),
      k8sGcloudDeployment({
        isStepEnabled: false,
        gcloudProjectId: GCLOUD_PROJECT_ID,
        k8sClusterName: K8S_CLUSTER_NAME,
        k8sClusterTokenBase64: K8S_CLUSTER_TOKEN!,
        k8sClusterZoneName: K8S_CLUSTER_ZONE_NAME,
        artifactNameToContainerName: _.identity,
        artifactNameToDeploymentName: _.identity,
      }),
      jsonReporter(),
      cliTableReporter(),
    ]),
  }
}
