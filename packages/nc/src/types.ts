import { IPackageJson } from 'package-json-type'

export type Protocol = 'http' | 'https'

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

export type CiOptions = {
  logFilePath: string
  repoPath: string
  shouldPublish: boolean
  isDryRun: boolean
  skipTests: boolean
  npmRegistry: ServerInfo
  dockerRegistry: ServerInfo
  gitServer: ServerInfo
  redisServer: ServerInfo
  dockerOrganizationName: string
  gitRepositoryName: string
  gitOrganizationName: string
  auth: Auth
}

export type PackageName = string
export type PackageVersion = string

export enum TargetType {
  docker = 'docker',
  npm = 'npm',
}

export type TargetInfo<TargetTypParam extends TargetType> = { targetType: TargetTypParam } & (
  | {
      needPublish: true
      newVersion: string
    }
  | {
      needPublish: { alreadyPublishedAsVersion: string }
    }
)

export type PackageInfo = {
  relativePackagePath: string
  packagePath: string
  packageHash: string
  packageJson: IPackageJson
  target?: TargetInfo<TargetType.npm> | TargetInfo<TargetType.docker>
}

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
  disconnect: () => Promise<unknown>
}

export enum StepName {
  install = 'install',
  build = 'build',
  test = 'test',
  publish = 'publish',
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
}

export type PackageStepResult = {
  install: { packageInfo: PackageInfo; stepResult: StepResult<StepName.install> }
  build: { packageInfo: PackageInfo; stepResult: StepResult<StepName.build> }
  test: { packageInfo: PackageInfo; stepResult: StepResult<StepName.test> }
  publish: { packageInfo: PackageInfo; stepResult: StepResult<StepName.publish> & { publishedVersion?: string } }
  report: { packageInfo: PackageInfo; stepResult: StepResult<StepName.report> }
}

export type PackagesStepResult<StepNameParam extends StepName> = StepResult<StepNameParam> & {
  executionOrder: number
  packagesResult: Graph<PackageStepResult[StepNameParam]>
}

export type CombinedPackageStepReportResult = { [StepName.report]: PackageStepResult[StepName.report] } & (
  | {}
  | { [StepName.install]: PackageStepResult[StepName.install] }
  | {
      [StepName.install]: PackageStepResult[StepName.install]
      [StepName.build]: PackageStepResult[StepName.build]
    }
  | {
      [StepName.install]: PackageStepResult[StepName.install]
      [StepName.build]: PackageStepResult[StepName.build]
      [StepName.test]: PackageStepResult[StepName.test]
    }
  | {
      [StepName.install]: PackageStepResult[StepName.install]
      [StepName.build]: PackageStepResult[StepName.build]
      [StepName.test]: PackageStepResult[StepName.test]
      [StepName.publish]: PackageStepResult[StepName.publish]
    }
)

export type ExecutedStepsWithoutReport =
  | {}
  | { [StepName.install]: PackagesStepResult<StepName.install> }
  | {
      [StepName.install]: PackagesStepResult<StepName.install>
      [StepName.build]: PackagesStepResult<StepName.build>
    }
  | {
      [StepName.install]: PackagesStepResult<StepName.install>
      [StepName.build]: PackagesStepResult<StepName.build>
      [StepName.test]: PackagesStepResult<StepName.test>
    }
  | {
      [StepName.install]: PackagesStepResult<StepName.install>
      [StepName.build]: PackagesStepResult<StepName.build>
      [StepName.test]: PackagesStepResult<StepName.test>
      [StepName.publish]: PackagesStepResult<StepName.publish>
    }

export type ExecutedSteps = ExecutedStepsWithoutReport & { [StepName.report]: PackagesStepResult<StepName.report> }

export type JsonReport = {
  graph: Graph<{ packageInfo: PackageInfo; stepsResult: CombinedPackageStepReportResult; stepsSummary: StepsSummary }>
  steps: ExecutedSteps
  summary: StepsSummary
}
