import Redis, { ValueType } from 'ioredis'
import NodeCache from 'node-cache'
import { Log } from '@tahini/log'
import { Artifact, Graph, Node } from '../types'

export type Cache = {
  step: {
    didStepRun: (options: { stepId: string; packageHash: string }) => Promise<boolean>
    getStepResult: (options: {
      stepId: string
      packageHash: string
      ttlMs: number
    }) => Promise<
      | {
          didStepRun: true
          StepStatus: StepStatus
          flowId: string
        }
      | { didStepRun: false }
      | undefined
    >
    setStepResult: (options: {
      stepId: string
      packageHash: string
      stepStatus: StepStatus
      ttlMs: number
    }) => Promise<void>
  }
  get: <T>(key: string, ttl: number, mapper: (result: unknown) => T) => Promise<T | undefined>
  set: (key: string, value: ValueType, ttl: number) => Promise<void>
  has: (key: string) => Promise<boolean>
  nodeCache: NodeCache
  redisClient: Redis.Redis
  cleanup: () => Promise<unknown>
}

export enum StepStatus {
  passed = 'passed',
  skippedAsPassed = 'skipped-as-passed',
  skippedAsFailed = 'skipped-as-failed',
  skippedAsFailedBecauseLastStepFailed = 'skipped-because-last-step-is-considered-as-failed',
  failed = 'failed',
}

export type StepInfo = {
  stepName: string
  stepId: string
}

export type StepResultOfPackage = StepInfo & {
  status: StepStatus
  durationMs: number
  notes: string[]
  error?: unknown
}

export type StepResultOfAllPackages = {
  stepSummary: StepResultOfPackage
  packagesResult: Graph<{ artifact: Artifact; stepResult: StepResultOfPackage }>
}

export type CanRunStep = {
  customPredicate?: (options: {
    allPackages: Graph<{ artifact: Artifact }>
    cache: Cache
    currentStepInfo: Node<{ stepInfo: StepInfo }>
    allSteps: Graph<{ stepInfo: StepInfo; stepResult?: StepResultOfPackage }>
  }) => Promise<{ canRun: boolean; notes: string[] }>
  options?: {
    runCustomPredicateAsLastCheck?: boolean
    skipIfSomeDirectPrevStepsFailedOnPackage?: boolean
    skipIfPackageResultsInCache?: boolean
  }
}

export type AllStepsInfo = Graph<
  StepInfo & {
    canRunStep?: CanRunStep
  }
>

export type CreateStep = (
  createStepOptions: CreateStepOptions,
) => (runStepOptions: RunStepOptions) => Promise<StepResultOfAllPackages>

export type StepsSummary = {
  status: StepStatus
  durationMs: number
  notes: string[]
  error?: unknown
}

export type PackageUserStepResult = {
  artifactName: string
  stepResult: {
    durationMs: number
    status: StepStatus
    notes: string[]
    error?: unknown
  }
}

export type RunStepOptions = {
  stepName: string
  stepId: string
  repoPath: string
  graph: Graph<{ artifact: Artifact }>
  cache: Cache
}

export type UserRunStepOptions = Pick<RunStepOptions, 'stepName' | 'repoPath' | 'graph'> & {
  log: Log
  cache: {
    step: {
      didStepRun: (options: { packageHash: string }) => ReturnType<Cache['step']['didStepRun']>
      getStepResult: (options: { packageHash: string; ttlMs: number }) => ReturnType<Cache['step']['getStepResult']>
      setStepResult: (options: {
        packageHash: string
        stepStatus: StepStatus
        ttlMs: number
      }) => ReturnType<Cache['step']['setStepResult']>
    }
  } & Pick<Cache, 'get' | 'set' | 'has' | 'nodeCache' | 'redisClient'>
}

export type UserStepResult = {
  stepSummary: {
    notes: string[]
    error?: unknown
  }
  packagesResult: PackageUserStepResult[]
}

export type RunStep = (options: UserRunStepOptions) => Promise<UserStepResult>

export type CreateStepOptions = {
  stepName: string
  runStep: RunStep
  canRunStep?: CanRunStep
}
