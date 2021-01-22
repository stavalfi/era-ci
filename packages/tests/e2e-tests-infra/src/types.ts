import { Config, Logger, LogLevel, StepRedisEvent, TaskQueueBase } from '@era-ci/core'
import { JsonReport } from '@era-ci/steps'
import { Graph, PackageJson, StepInfo, TargetType } from '@era-ci/utils'
import { FolderStructure } from 'create-folder-structure'
import { IDependencyMap } from 'package-json-type'
import { DeepPartial } from 'ts-essentials'
import { GitServer } from './git-server-testkit'

import { ExecutionContext, TestInterface } from 'ava'
import { Redis } from 'ioredis'
export type TestWithContextType = {
  resources: TestResources
  sleep: (ms: number) => Promise<void>
  createRepo: CreateRepo
  cleanups: Cleanup[]
  processEnv: NodeJS.ProcessEnv
  testLogger: Logger
}
export type TestWithContext = TestInterface<TestWithContextType>

export { DeepPartial } from 'ts-essentials'
export { TargetType, PackageJson }

export type Cleanup = () => Promise<unknown>

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
      token: string
      email: string
    }
  }
  dockerRegistry: string
  gitServer: GitServer
  redisServerUrl: string
  redisServerHost: string
  redisServerPort: number
  quayMockService: Deployment
  quayHelperService: Deployment
  quayNamespace: string
  quayToken: string
  quayBuildStatusChangedRedisTopic: string
  redisFlowEventsSubscriptionsConnection: Redis
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
}

export type CreateRepo = (
  t: ExecutionContext<TestWithContextType>,
  options:
    | CreateRepoOptions<TaskQueueBase<any, any>>
    | ((toActualName: ToActualName) => CreateRepoOptions<TaskQueueBase<any, any>>),
) => Promise<{
  repoPath: string
  gitHeadCommit: () => Promise<string>
  getImageTags: (packageName: string) => Promise<string[]>
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
  flowEvents: StepRedisEvent[]
}

type Deployment = { address: string; cleanup: () => Promise<unknown> }
