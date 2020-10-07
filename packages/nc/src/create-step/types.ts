import { Cache } from '../create-cache'
import { Log, Logger } from '../create-logger'
import { Artifact, Graph, Node, PackageJson } from '../types'
import { ErrorObject } from 'serialize-error'

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

export type StepInfo = {
  stepName: string
  stepId: string
}

export type DoneResult = {
  executionStatus: ExecutionStatus.done
  status: Status.passed | Status.failed
  durationMs: number
  notes: string[]
  error?: ErrorObject
}

export type AbortResult<StatusType extends Status> = {
  executionStatus: ExecutionStatus.aborted
  status: StatusType
  durationMs: number
  notes: string[]
  error?: ErrorObject
}

export type RunningResult = {
  executionStatus: ExecutionStatus.running
}

export type ScheduledResult = {
  executionStatus: ExecutionStatus.scheduled
}

export type DoneStepResultOfArtifacts = {
  stepInfo: StepInfo
  stepResult: DoneResult
  artifactsResult: Graph<{
    artifact: Artifact
    artifactStepResult: DoneResult
  }>
}

export type AbortStepResultOfArtifacts = {
  stepInfo: StepInfo
  stepResult: AbortResult<Status>
  artifactsResult: Graph<{
    artifact: Artifact
    artifactStepResult: DoneResult | AbortResult<Status.skippedAsFailed | Status.skippedAsPassed>
  }>
}

export type RunningStepResultOfArtifacts = {
  stepInfo: StepInfo
  stepResult: RunningResult
  artifactsResult: Graph<{
    artifact: Artifact
    artifactStepResult:
      | DoneResult
      | AbortResult<Status.skippedAsFailed | Status.skippedAsPassed>
      | RunningResult
      | ScheduledResult
  }>
}

export type ScheduledStepResultOfArtifacts = {
  stepInfo: StepInfo
  stepResult: ScheduledResult
  artifactsResult: Graph<{ artifact: Artifact; artifactStepResult: ScheduledResult }>
}

export type StepResultOfArtifacts =
  | DoneStepResultOfArtifacts
  | AbortStepResultOfArtifacts
  | RunningStepResultOfArtifacts
  | ScheduledStepResultOfArtifacts

export type StepsResultOfArtifactsByStep = Graph<StepResultOfArtifacts>

export type DoneStepsResultOfArtifact = {
  artifact: Artifact
  artifactResult: DoneResult
  stepsResult: Graph<{
    stepInfo: StepInfo
    artifactStepResult: DoneResult
  }>
}

export type AbortStepsResultOfArtifact = {
  artifact: Artifact
  artifactResult: AbortResult<Status>
  stepsResult: Graph<{
    stepInfo: StepInfo
    artifactStepResult: DoneResult | AbortResult<Status.skippedAsFailed | Status.skippedAsPassed>
  }>
}

export type RunningStepsResultOfArtifact = {
  artifact: Artifact
  artifactResult: RunningResult
  stepsResult: Graph<{
    stepInfo: StepInfo
    artifactStepResult:
      | DoneResult
      | AbortResult<Status.skippedAsFailed | Status.skippedAsPassed>
      | RunningResult
      | ScheduledResult
  }>
}

export type ScheduledStepsResultOfArtifact = {
  artifact: Artifact
  artifactResult: ScheduledResult
  stepsResult: Graph<{
    stepInfo: StepInfo
    artifactStepResult: ScheduledResult
  }>
}

export type StepsResultOfArtifact =
  | DoneStepsResultOfArtifact
  | AbortStepsResultOfArtifact
  | RunningStepsResultOfArtifact
  | ScheduledStepsResultOfArtifact

export type StepsResultOfArtifactsByArtifact = Graph<StepsResultOfArtifact>

export type CanRunStepOnArtifactResult =
  | {
      canRun: true
      artifactStepResult: {
        notes: string[]
        error?: ErrorObject
      }
    }
  | {
      canRun: false
      artifactStepResult: Omit<AbortResult<Status.skippedAsFailed | Status.skippedAsPassed>, 'durationMs'>
    }

export type CanRunStepOnArtifact<StepConfigurations> = {
  customPredicate?: (
    options: UserRunStepOptions<StepConfigurations> & { currentArtifact: Node<{ artifact: Artifact }> },
  ) => Promise<true | CanRunStepOnArtifactResult>
  options?: {
    runIfSomeDirectParentStepFailedOnPackage?: boolean
    runIfPackageResultsInCache?: boolean
  }
}

export type RunStepOptions = {
  flowId: string
  startFlowMs: number
  repoPath: string
  rootPackageJson: PackageJson
  artifacts: Graph<{ artifact: Artifact }>
  steps: Graph<{ stepInfo: StepInfo }>
  currentStepInfo: Node<{ stepInfo: StepInfo }>
  stepsResultOfArtifactsByStep: StepsResultOfArtifactsByStep
  stepsResultOfArtifactsByArtifact: StepsResultOfArtifactsByArtifact
  cache: Cache
  logger: Logger
}

export type UserRunStepOptions<StepConfigurations> = RunStepOptions & {
  log: Log
  stepConfigurations: StepConfigurations
  startStepMs: number
}

export type UserArtifactResult = {
  artifactName: string
  stepResult: DoneResult | AbortResult<Status.skippedAsFailed | Status.skippedAsPassed>
}

export type UserStepResult = {
  stepResult: {
    notes: string[]
    error?: unknown
  }
  artifactsResult: UserArtifactResult[]
}

export type RunStepOnArtifacts<StepConfigurations> = (
  options: UserRunStepOptions<StepConfigurations>,
) => Promise<UserStepResult>

export type RunStepOnArtifact<StepConfigurations> = (
  options: UserRunStepOptions<StepConfigurations> & { currentArtifact: Node<{ artifact: Artifact }> },
) => Promise<Omit<DoneResult, 'durationMs'>>

export type RunStepOnRoot<StepConfigurations> = (
  options: UserRunStepOptions<StepConfigurations>,
) => Promise<Omit<DoneResult, 'durationMs'>>

export type Step = {
  stepName: string
  runStep: (runStepOptions: RunStepOptions) => Promise<StepResultOfArtifacts>
}

export type SkipStepOnArtifactPredicate<StepConfigurations> = (
  options: UserRunStepOptions<StepConfigurations> & { currentArtifact: Node<{ artifact: Artifact }> },
) => Promise<true | CanRunStepOnArtifactResult>

export type CreateStepOptions<StepConfigurations, NormalizedStepConfigurations = StepConfigurations> = {
  stepName: string
  normalizeStepConfigurations?: (stepConfigurations: StepConfigurations) => Promise<NormalizedStepConfigurations>
  canRunStepOnArtifact?: CanRunStepOnArtifact<NormalizedStepConfigurations>
  skipStepOnArtifactPredicates?: SkipStepOnArtifactPredicate<NormalizedStepConfigurations>[]
  onStepDone?: (options: UserRunStepOptions<NormalizedStepConfigurations>) => Promise<void>
} & (
  | { runStepOnArtifacts: RunStepOnArtifacts<NormalizedStepConfigurations> }
  | {
      beforeAll?: (options: UserRunStepOptions<NormalizedStepConfigurations>) => Promise<void>
      runStepOnArtifact: RunStepOnArtifact<NormalizedStepConfigurations>
      afterAll?: (options: UserRunStepOptions<NormalizedStepConfigurations>) => Promise<void>
    }
  | {
      runStepOnRoot: RunStepOnRoot<NormalizedStepConfigurations>
    }
)
