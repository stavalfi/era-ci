import { IPackageJson } from 'package-json-type'

export type Cleanup = () => Promise<unknown>

export enum TargetType {
  docker = 'docker',
  npm = 'npm',
}

export type TargetToPublish<TargetTypParam extends TargetType> = { targetType: TargetTypParam } & (
  | {
      needPublish: true
      newVersion: string
    }
  | {
      needPublish: { alreadyPublishedAsVersion: string }
    }
)

export type Artifact = {
  relativePackagePath: string
  packagePath: string
  packageHash: string
  packageJson: IPackageJson
  targetType?: TargetType
  publishInfo?: TargetToPublish<TargetType> // if this property is undefined, it means that the user didn't specify publish configurations for this `targetType`
}

export type ArtifactToDeploy<Target extends TargetType> = {
  packagePath: string
  packageJson: IPackageJson
  publishedVersion: string
} & (Target extends TargetType.docker
  ? {
      fullImageName: string
    }
  : {})

export enum Protocol {
  http = 'http',
  https = 'https',
}

export type ServerInfo = {
  host: string
  port: number
  protocol?: Protocol
}

type DeployOptions<DeploymentClient, Target extends TargetType> = {
  deploymentClient: DeploymentClient
  artifactToDeploy: ArtifactToDeploy<Target>
}

export type Deploy<DeploymentClient, Target extends TargetType> = (
  options: DeployOptions<DeploymentClient, Target>,
) => Promise<void>

export type DeployTarget<DeploymentClient, Target extends TargetType> = {
  initializeDeploymentClient: () => Promise<DeploymentClient>
  deploy: Deploy<DeploymentClient, Target>
  destroyDeploymentClient: (options: { deploymentClient: DeploymentClient }) => Promise<void>
}

export type TargetsPublishAuth = {
  [TargetType.npm]: {
    username: string
    email: string
    token: string
  }
  [TargetType.docker]: {
    username?: string
    token?: string
  }
}

export type TargetInfo<Target extends TargetType, DeploymentClient, ServerInfoType = ServerInfo> = {
  shouldPublish: boolean
  registry: ServerInfoType
  publishAuth: TargetsPublishAuth[Target]
} & (
  | { shouldDeploy: false; deployment?: DeployTarget<DeploymentClient, Target> }
  | { shouldDeploy: true; deployment: DeployTarget<DeploymentClient, Target> }
) &
  (Target extends TargetType.docker
    ? {
        dockerOrganizationName: string
      }
    : {})

export type TargetsInfo<DeploymentClient, ServerInfoType = ServerInfo> = {
  [Target in TargetType]?: TargetInfo<Target, DeploymentClient, ServerInfoType>
}

export type CiOptions<DeploymentClient, ServerInfoType = ServerInfo> = {
  repoPath: string
  redis: {
    redisServer: ServerInfoType
    auth: {
      password?: string
    }
  }
  git: {
    gitRepoUrl: string
    gitRepositoryName: string
    gitOrganizationName: string
    auth: {
      username: string
      token: string
    }
  }
  targetsInfo?: TargetsInfo<DeploymentClient, ServerInfoType>
}

export type ConfigFileOptions<DeploymentClient = never> = Omit<
  CiOptions<DeploymentClient, string>,
  'repoPath' | 'git'
> & {
  git: {
    auth: CiOptions<DeploymentClient, string>['git']['auth']
  }
}

export type PackageName = string
export type PackageVersion = string

export type TargetToDeploy<TargetTypParam extends TargetType> = { targetType: TargetTypParam; publishedVersion: string }

export type Node<T> = {
  data: T
  index: number
  parentsIndexes: number[]
  childrenIndexes: number[]
}

export type Graph<T> = Node<T>[]

export enum CacheTypes {
  publish = 'publish',
}

export type PublishCache = {
  isPublished: (packageName: string, packageHash: string) => Promise<PackageVersion | false>
  setAsPublished: (packageName: string, packageHash: string, packageVersion: PackageVersion) => Promise<void>
}

export type Cache = {
  test: {
    isTestsRun: (packageName: string, packageHash: string) => Promise<boolean>
    isPassed: (packageName: string, packageHash: string) => Promise<boolean>
    setResult: (packageName: string, packageHash: string, isPassed: boolean) => Promise<void>
  }
  publish: {
    [Target in TargetType]?: PublishCache
  }
  cleanup: () => Promise<unknown>
}

export enum StepName {
  install = 'install',
  build = 'build',
  test = 'test',
  publish = 'publish',
  deployment = 'deployment',
  report = 'report',
}

export enum StepStatus {
  passed = 'passed',
  skippedAsPassed = 'skipped-as-passed',
  skippedAsFailed = 'skipped-as-failed',
  skippedAsFailedBecauseLastStepFailed = 'skipped-because-last-step-is-considered-as-failed',
  failed = 'failed',
}

export type StepResult<StepNameParam extends StepName> = {
  stepName: StepNameParam
  status: StepStatus
  durationMs: number
  notes: string[]
  error?: unknown
}

// it is used as package-summary and as a ci-summary
export type StepsSummary = {
  status: StepStatus
  durationMs: number
  notes: string[]
  error?: unknown
}

export type PackageStepResult = {
  install: StepResult<StepName.install>
  build: StepResult<StepName.build>
  test: StepResult<StepName.test>
  publish: StepResult<StepName.publish> & {
    publishedVersion?: string
  }
  deployment: StepResult<StepName.deployment>
  report: StepResult<StepName.report>
}

export type PackagesStepResult<StepNameParam extends StepName> = StepResult<StepNameParam> & {
  executionOrder: number
  packagesResult: Graph<{ artifact: Artifact; stepResult: PackageStepResult[StepNameParam] }>
}

export type JsonReport = {
  graph: Graph<{
    artifact: Artifact
    stepsResult: { [stepName in StepName]?: PackageStepResult[stepName] }
    stepsSummary: StepsSummary
  }>
  steps: {
    [stepName in StepName]?: PackagesStepResult<stepName>
  }
  summary: StepsSummary
}
