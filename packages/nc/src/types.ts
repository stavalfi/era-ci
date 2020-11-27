import { IDependencyMap, IScriptsMap } from 'package-json-type'
import { ErrorObject } from 'serialize-error'

export type Cleanup = () => Promise<unknown>

export type PackageJson = {
  name: string
  version: string
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

export type DoneResult = {
  executionStatus: ExecutionStatus.done
  status: Status.passed | Status.failed
  durationMs: number
  notes: Array<string>
  errors: Array<ErrorObject>
}

export type AbortResult<StatusType extends Status> = {
  executionStatus: ExecutionStatus.aborted
  status: StatusType
  durationMs?: number
  notes: Array<string>
  errors: Array<ErrorObject>
}

export type RunningResult = {
  executionStatus: ExecutionStatus.running
}

export type ScheduledResult = {
  executionStatus: ExecutionStatus.scheduled
}

export enum ConstrainResult {
  shouldRun = 'should-run',
  shouldSkip = 'should-skip',
  ignoreThisConstrain = 'ignore-this-constrain',
}

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
