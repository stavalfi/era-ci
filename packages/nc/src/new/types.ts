import Redis, { ValueType } from 'ioredis'
import NodeCache from 'node-cache'
import { Log } from '@tahini/log'
import { Artifact, Graph, Node } from '../types'
import { IPackageJson } from 'package-json-type'

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
  artifactsResult: Graph<{ artifact: Artifact; stepResult: StepResultOfPackage }>
}

export type RootPackage = {
  packagePath: string
  packageJson: IPackageJson
}

export type CanRunStepOnArtifact<StepConfigurations> = {
  customPredicate?: (options: {
    allArtifacts: Graph<{ artifact: Artifact }>
    cache: Cache
    rootPackage: RootPackage
    currentArtifact: Node<{ artifact: Artifact }>
    currentStepInfo: Node<{ stepInfo: StepInfo }>
    allSteps: Graph<{ stepInfo: StepInfo; stepResult?: StepResultOfPackage }>
    stepConfigurations: StepConfigurations
  }) => Promise<CanRunStepOnArtifactResult>
  options?: {
    skipIfSomeDirectPrevStepsFailedOnPackage?: boolean
    skipIfPackageResultsInCache?: boolean
  }
}

export type StepsSummary = {
  status: StepStatus
  durationMs: number
  notes: string[]
  error?: unknown
}

export type RunStepOptions = StepInfo & {
  repoPath: string
  allArtifacts: Graph<{ artifact: Artifact }>
  allSteps: Graph<{ stepInfo: StepInfo; stepResult?: StepResultOfPackage }>
  currentStepIndex: number
  cache: Cache
  rootPackage: RootPackage
}

export type UserRunStepCache = {
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

export type UserRunStepOptions<StepConfigurations> = Pick<RunStepOptions, 'stepName' | 'repoPath'> & {
  log: Log
  cache: UserRunStepCache
  allArtifacts: Graph<{ artifact: Artifact }>
  stepConfigurations: StepConfigurations
}

export type UserArtifactResult = {
  artifactName: string
  stepResult: {
    durationMs: number
    status: StepStatus
    notes: string[]
    error?: unknown
  }
}

export type UserStepResult = {
  stepSummary: {
    notes: string[]
    error?: unknown
  }
  artifactsResult: UserArtifactResult[]
}

export type RunStepOnAllArtifacts<StepConfigurations> = (
  options: UserRunStepOptions<StepConfigurations>,
) => Promise<UserStepResult>

export type RunStepOnArtifact<StepConfigurations> = (
  options: UserRunStepOptions<StepConfigurations> & { currentArtifact: Node<{ artifact: Artifact }> },
) => Promise<{
  status: StepStatus
  notes?: string[]
  error?: unknown
}>

export type RunStepOnRoot<StepConfigurations> = (
  options: UserRunStepOptions<StepConfigurations>,
) => Promise<{
  status: StepStatus
  notes?: string[]
  error?: unknown
}>

export type CreateStepOptions<StepConfigurations, NormalizedStepConfigurations = StepConfigurations> = {
  stepName: string
  normalizeStepConfigurations?: (stepConfigurations: StepConfigurations) => Promise<NormalizedStepConfigurations>
  canRunStepOnArtifact?: CanRunStepOnArtifact<NormalizedStepConfigurations>
} & (
  | { runStepOnAllArtifacts: RunStepOnAllArtifacts<NormalizedStepConfigurations> }
  | {
      beforeAll?: (options: UserRunStepOptions<NormalizedStepConfigurations>) => Promise<void>
      runStepOnArtifact: RunStepOnArtifact<NormalizedStepConfigurations>
      afterAll?: (options: UserRunStepOptions<NormalizedStepConfigurations>) => Promise<void>
    }
  | {
      runStepOnRoot: RunStepOnRoot<NormalizedStepConfigurations>
    }
)

export type CanRunStepOnArtifactResult =
  | {
      canRun: true
      notes: string[]
    }
  | {
      canRun: false
      notes: string[]
      stepStatus: StepStatus
    }

export type RunStep = (runStepOptions: RunStepOptions) => Promise<StepResultOfAllPackages>
