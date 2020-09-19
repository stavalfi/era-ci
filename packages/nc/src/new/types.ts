import { Log } from '@tahini/log'
import { IPackageJson } from 'package-json-type'
import { Graph, Node } from '../types'
import { Cache } from './create-cache'
import { StepExecutionStatus, StepStatus } from './create-step'

export type Cleanup = () => Promise<unknown>

export type PackageJson = Omit<IPackageJson, 'name' | 'version'> & Required<Pick<IPackageJson, 'name' | 'version'>>

export type StepInfo = {
  stepName: string
  stepId: string
}

export type Step = {
  stepName: string
  runStep: RunStep
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
  packageJson: PackageJson
}

export type CanRunStepOnArtifact<StepConfigurations> = {
  customPredicate?: (options: {
    allArtifacts: Graph<{ artifact: Artifact }>
    cache: Cache
    rootPackage: RootPackage
    currentArtifact: Node<{ artifact: Artifact }>
    currentStepInfo: Node<{ stepInfo: StepInfo }>
    allSteps: Graph<{ stepInfo: StepInfo; stepResult?: StepResultOfAllPackages }>
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

export type Artifact = {
  relativePackagePath: string
  packagePath: string
  packageHash: string
  packageJson: Omit<PackageJson, 'name' | 'version'> & Required<Pick<PackageJson, 'name' | 'version'>>
}

export type RunStepOptions = StepInfo & {
  flowId: string
  startFlowMs: number
  repoPath: string
  allArtifacts: Graph<{ artifact: Artifact }>
  allSteps: Graph<StepNodeData<StepResultOfAllPackages>>
  currentStepIndex: number
  cache: Cache
  rootPackage: RootPackage
}

export type UserRunStepCache = {
  step: {
    didStepRun: (options: { packageHash: string }) => ReturnType<Cache['step']['didStepRun']>
    getStepResult: (options: { packageHash: string }) => ReturnType<Cache['step']['getStepResult']>
    setStepResult: (options: {
      packageHash: string
      stepStatus: StepStatus
      ttlMs: number
    }) => ReturnType<Cache['step']['setStepResult']>
  }
} & Pick<Cache, 'get' | 'set' | 'has' | 'nodeCache' | 'redisClient' | 'ttls'>

export type StepNodeData<StepResult> =
  | { stepInfo: StepInfo; stepExecutionStatus: StepExecutionStatus.done; stepResult: StepResult }
  | {
      stepInfo: StepInfo
      stepExecutionStatus: StepExecutionStatus.running | StepExecutionStatus.aborted | StepExecutionStatus.scheduled
    }

export type UserRunStepOptions<StepConfigurations> = Pick<
  RunStepOptions,
  'stepName' | 'stepId' | 'repoPath' | 'allArtifacts' | 'flowId' | 'startFlowMs'
> & {
  log: Log
  cache: UserRunStepCache
  stepConfigurations: StepConfigurations
  steps: Graph<StepNodeData<StepResultOfAllPackages>>
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
  onStepDone?: (
    options: UserRunStepOptions<NormalizedStepConfigurations> & {
      currentStepResultOnArtifacts: Graph<{
        artifact: Artifact
        stepsResult: StepResultOfPackage[]
        stepsSummary: StepsSummary
      }>
    },
  ) => Promise<void>
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
