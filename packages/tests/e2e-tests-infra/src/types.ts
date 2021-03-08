import { Config, Log, Logger, LogLevel, RedisFlowEvent, TaskQueueBase } from '@era-ci/core'
import { JsonReport } from '@era-ci/steps'
import { Graph, PackageJson, StepInfo, TargetType } from '@era-ci/utils'
import { AppsV1Api, V1Deployment } from '@kubernetes/client-node'
import { FolderStructure } from '@stavalfi/create-folder-structure'
import { Redis } from 'ioredis'
import { IDependencyMap } from 'package-json-type'
import type { DeepPartial } from 'ts-essentials'
import { QuayMockDb } from '@era-ci/quay-mock-service'
import { GitServer } from './git-server-testkit'

export type TestWithContextType = {
  resources: TestResources
  sleep: (ms: number) => Promise<void>
  createRepo: CreateRepo
  cleanups: Cleanup[]
  processEnv: NodeJS.ProcessEnv
  testLogger: Logger
}

export { TargetType, PackageJson }

export type Cleanup = () => Promise<unknown>

export type GetCleanups = () => {
  cleanups: Cleanup[]
  connectionCleanups: Cleanup[]
}

export type TestFuncs = {
  k8sHelpers: K8sHelpers
  sleep: (ms: number) => Promise<void>
  getProcessEnv: () => TestProcessEnv
  getResources: () => TestResources
  createRedisConnection: (s?: string) => Redis
  getCleanups: GetCleanups
  createTestLogger: (repoPath: string) => Promise<Logger>
}

export type TestProcessEnv = {
  ERA_TEST_MODE: string
  SKIP_EXIT_CODE_1: string
  QUAY_BUILD_STATUS_CHANED_TEST_REDIS_TOPIC: string
  ERA_CI_EVENTS_TOPIC_PREFIX: string
} & NodeJS.ProcessEnv

export type Package = {
  name: string
  version: string
  targetType?: TargetType
  'index.js'?: string
  dependencies?: IDependencyMap
  devDependencies?: IDependencyMap
  src?: FolderStructure
  tests?: FolderStructure
  additionalFiles?: FolderStructure
  scripts?: PackageJson['scripts']
}

export type Repo = {
  packages?: Package[]
  rootFiles?: FolderStructure
  rootPackageJson?: DeepPartial<PackageJson>
}

export type TestResources = {
  npmRegistry: {
    address: string
    auth: {
      username: string
      password: string
      email: string
    }
  }
  dockerRegistry: string
  gitServer: GitServer
  redisServerUrl: string
  quayMockService: Deployment & { db: QuayMockDb }
  quayHelperService: Deployment
  quayNamespace: string
  quayToken: string
  quayBuildStatusChangedRedisTopic: string
  redisFlowEventsSubscriptionsConnection: Redis
  k8s: {
    kubeConfigBase64: string
    deploymentApi: AppsV1Api
  }
}

export type ToActualName = (name: string) => string

export type ResultingArtifact = {
  npm: {
    versions: Array<string>
    highestVersion?: string
  }
  docker: {
    tags: Array<string>
  }
}

export type CreateRepoOptions<TaskQueue extends TaskQueueBase<any, any>> = {
  repo: Repo
  configurations?: Partial<Config<TaskQueue>>
  dontAddReportSteps?: boolean
  logLevel?: LogLevel
  overrideInitialInstallNpmRegistry?: string
}

export type CreateRepo = (
  options:
    | CreateRepoOptions<TaskQueueBase<any, any>>
    | ((toActualName: ToActualName) => CreateRepoOptions<TaskQueueBase<any, any>>),
) => Promise<{
  testLog: Log
  repoPath: string
  repoName: string
  gitHeadCommit: () => Promise<string>
  runCi: (options?: { processEnv?: NodeJS.ProcessEnv }) => Promise<RunCiResult>
  toActualName: ToActualName
}>

export type RunCiResult = {
  flowId: string
  steps: Graph<{ stepInfo: StepInfo }>
  jsonReport: JsonReport
  passed: boolean
  logFilePath: string
  flowLogs: string
  published: Map<string, ResultingArtifact>
  flowEvents: RedisFlowEvent[]
  printFlowLogsFromCli: (flowId?: string) => Promise<string>
}

type Deployment = { address: string; cleanup: () => Promise<unknown> }

export type CreateK8sDeployment = (options: {
  namespaceName: string
  deploymentName: string
  podName: string
  containerName: string
  fullImageName: string
  portInContainer: number
  labels: { app: string }
  progressDeadlineSeconds?: number
  minReadySeconds?: number
}) => Promise<V1Deployment>

export type FindPodName = (deploymentName: string) => Promise<string | undefined>

export type K8sHelpers = { createK8sDeployment: CreateK8sDeployment; findPodName: FindPodName }
