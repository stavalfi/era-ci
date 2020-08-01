import { IPackageJson } from 'package-json-type'

export type Cleanup = () => Promise<unknown>

export enum TargetType {
  docker = 'docker',
  npm = 'npm',
}

export type Artifact = {
  relativePackagePath: string
  packagePath: string
  packageHash: string
  packageJson: IPackageJson
  target?: TargetToPublish<TargetType.npm> | TargetToPublish<TargetType.docker>
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

export type Auth = {
  npmRegistryUsername: string
  npmRegistryEmail: string
  npmRegistryToken: string
  gitServerUsername: string
  gitServerToken: string
  redisPassword?: string
  dockerRegistryUsername?: string
  dockerRegistryToken?: string
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

export type Deployment<DeploymentClient> = {
  [Target in TargetType]?: DeployTarget<DeploymentClient, Target>
}
export type CiOptions<DeploymentClient> = {
  repoPath: string
  shouldPublish: boolean
  npmRegistry: ServerInfo
  dockerRegistry: ServerInfo
  redisServer: ServerInfo
  gitRepoUrl: string
  dockerOrganizationName: string
  gitRepositoryName: string
  gitOrganizationName: string
  shouldDeploy: boolean
  deployment?: Deployment<DeploymentClient>
  auth: Auth
}

export type ConfigFileOptions<DeploymentClient = never> = Pick<
  CiOptions<DeploymentClient>,
  'shouldPublish' | 'shouldDeploy' | 'deployment'
> & {
  npmRegistryEmail: string
  npmRegistryUrl: string
  redisServerUrl: string
  dockerRegistryUrl: string
  dockerOrganizationName: string
}

export type PackageName = string
export type PackageVersion = string

export type TargetToPublish<TargetTypParam extends TargetType> = { targetType: TargetTypParam } & (
  | {
      needPublish: true
      newVersion: string
    }
  | {
      needPublish: { alreadyPublishedAsVersion: string }
    }
)

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

export type Cache = {
  test: {
    isTestsRun: (packageName: string, packageHash: string) => Promise<boolean>
    isPassed: (packageName: string, packageHash: string) => Promise<boolean>
    setResult: (packageName: string, packageHash: string, isPassed: boolean) => Promise<void>
  }
  publish: {
    npm: {
      isPublished: (packageName: string, packageHash: string) => Promise<PackageVersion | false>
      setAsPublished: (packageName: string, packageHash: string, packageVersion: PackageVersion) => Promise<void>
    }
    docker: {
      isPublished: (packageName: string, packageHash: string) => Promise<PackageVersion | false>
      setAsPublished: (packageName: string, packageHash: string, packageVersion: PackageVersion) => Promise<void>
    }
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
  publish: StepResult<StepName.publish> & { publishedVersion?: string }
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
