import type { IDependencyMap, IScriptsMap } from 'package-json-type'
import type { ErrorObject } from 'serialize-error'

export type Cleanup = () => Promise<unknown>

export type PackageJson = {
  name: string
  version: string
  license?: string
  private?: boolean
  scripts?: Partial<IScriptsMap> & { build?: string; lint?: string } & Record<string, string | undefined>
  dependencies?: IDependencyMap
  devDependencies?: IDependencyMap
  peerDependencies?: IDependencyMap
  main?: string
}

export type Node<T> = {
  data: T
  index: number
  parentsIndexes: Array<number>
  childrenIndexes: Array<number>
}

export type Graph<T> = Array<Node<T>>

export type Artifact = {
  relativePackagePath: string
  packagePath: string
  packageHash: string
  packageJson: PackageJson
}

export type StepInfo = {
  stepGroup: string
  stepName: string
  stepId: string
  displayName: string
}

export type UnionArrayValues<T, Array1 extends Array<T>> = Array1[number]

// ---------------------

// the following types are here to prevent circular imports

export enum Status {
  passed = 'passed',
  skippedAsPassed = 'skipped-as-passed',
  skippedAsFailed = 'skipped-as-failed',
  failed = 'failed',
}

export enum ExecutionStatus {
  scheduled = 'scheduled',
  running = 'running',
  done = 'done',
  aborted = 'aborted',
}

export type DoneResult<S = Status.passed | Status.failed> = {
  executionStatus: ExecutionStatus.done
  status: S
  durationMs: number
  notes: Array<string>
  errors: Array<ErrorObject>
  returnValue?: string
}

export type AbortResult<StatusType extends Status> = {
  executionStatus: ExecutionStatus.aborted
  status: StatusType
  durationMs: number
  notes: Array<string>
  errors: Array<ErrorObject>
  returnValue?: string
}

export type RunningResult = {
  executionStatus: ExecutionStatus.running
}

export type ScheduledResult = {
  executionStatus: ExecutionStatus.scheduled
}

export type Result =
  | RunningResult
  | ScheduledResult
  | DoneResult
  | AbortResult<Status.skippedAsFailed | Status.skippedAsPassed | Status.failed>

// ---------------------

export type GitRepoInfo = {
  commit: string
  repoNameWithOrgName: string
  repoName: string
  auth?: {
    username?: string
    token?: string
  }
}
