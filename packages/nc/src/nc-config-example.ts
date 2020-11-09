import ciInfo from 'ci-info'
import _ from 'lodash'
import {
  build,
  cliTableReporter,
  config,
  createLinearStepsGraph,
  dockerPublish,
  exampleTaskQueue,
  execaCommand,
  install,
  jsonReporter,
  k8sGcloudDeployment,
  lint,
  LocalSequentalTaskQueue,
  localSequentalTaskQueue,
  LogLevel,
  npmPublish,
  NpmScopeAccess,
  redisConnection,
  test,
  validatePackages,
  winstonLogger,
  ExampleTaskQueue,
} from './index'

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

type Cool<T> = { t: T }
function f1<T, U extends Cool<T>>(uArray: Array<U>) {
  return uArray
}

type T1 = 't1'
type T2 = 't2'
const t1: T1 = 't1'
const t2: T2 = 't2'
const r = f1([{ t: t1 }, { t: t2 }])

const x = createLinearStepsGraph([
  install(),
  validatePackages(),
  // lint({ lintScriptName: 'lint:code' }),
  // build(),
  // test({
  //   testScriptName: 'test',
  //   beforeAll: ({ log, repoPath }) => execaCommand(`yarn test-resources:up`, { cwd: repoPath, log, stdio: 'inherit' }),
  // }),
  // npmPublish({
  //   isStepEnabled: isMasterBuild,
  //   npmScopeAccess: NpmScopeAccess.public,
  //   registry: NPM_REGISTRY,
  //   publishAuth: {
  //     email: NPM_EMAIL,
  //     username: NPM_USERNAME!,
  //     token: NPM_TOKEN!,
  //   },
  // }),
  // dockerPublish({
  //   isStepEnabled: false,
  //   dockerOrganizationName: DOCKER_ORG,
  //   registry: DOCKER_REGISTRY,
  //   registryAuth: {
  //     username: DOCKER_HUB_USERNAME!,
  //     token: DOCKER_HUB_TOKEN!,
  //   },
  // }),
  // k8sGcloudDeployment({
  //   isStepEnabled: false,
  //   gcloudProjectId: GCLOUD_PROJECT_ID,
  //   k8sClusterName: K8S_CLUSTER_NAME,
  //   k8sClusterTokenBase64: K8S_CLUSTER_TOKEN!,
  //   k8sClusterZoneName: K8S_CLUSTER_ZONE_NAME,
  //   artifactNameToContainerName: _.identity,
  //   artifactNameToDeploymentName: _.identity,
  // }),
  // jsonReporter(),
  // cliTableReporter(),
])

export default config({
  taskQueues: [localSequentalTaskQueue.configure(), exampleTaskQueue.configure()],
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
  steps: x,
})
