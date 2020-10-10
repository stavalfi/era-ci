import { ErrorObject } from 'serialize-error'
import { Cache } from '../create-cache'
import { StepConstrain } from '../create-step-constrain'
import { Log, Logger } from '../create-logger'
import {
  AbortResult,
  Artifact,
  DoneResult,
  ExecutionStatus,
  Graph,
  Node,
  PackageJson,
  RunningResult,
  ScheduledResult,
  Status,
} from '../types'
import { ArtifactInStepConstrain } from '../create-artifact-in-step-constrain'

export type StepInfo = {
  stepName: string
  stepId: string
  displayName: string
}

// ------------------------

export type DoneStepResultOfArtifacts = {
  stepExecutionStatus: ExecutionStatus.done // this property is not needed but it is a workaround for: https://github.com/microsoft/TypeScript/issues/7294
  stepInfo: StepInfo
  stepResult: DoneResult
  artifactsResult: Graph<{
    artifact: Artifact
    artifactStepResult: DoneResult
  }>
}

export type AbortStepResultOfArtifacts = {
  stepExecutionStatus: ExecutionStatus.aborted // this property is not needed but it is a workaround for: https://github.com/microsoft/TypeScript/issues/7294
  stepInfo: StepInfo
  stepResult: AbortResult<Status>
  artifactsResult: Graph<{
    artifact: Artifact
    artifactStepResult: DoneResult | AbortResult<Status.skippedAsFailed | Status.skippedAsPassed>
  }>
}

export type RunningStepResultOfArtifacts = {
  stepExecutionStatus: ExecutionStatus.running // this property is not needed but it is a workaround for: https://github.com/microsoft/TypeScript/issues/7294
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
  stepExecutionStatus: ExecutionStatus.scheduled // this property is not needed but it is a workaround for: https://github.com/microsoft/TypeScript/issues/7294
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

// ------------------------

export type DoneStepsResultOfArtifact = {
  artifactExecutionStatus: ExecutionStatus.done // this property is not needed but it is a workaround for: https://github.com/microsoft/TypeScript/issues/7294
  artifact: Artifact
  artifactResult: DoneResult
  stepsResult: Graph<{
    stepInfo: StepInfo
    artifactStepResult: DoneResult
  }>
}

export type AbortStepsResultOfArtifact = {
  artifactExecutionStatus: ExecutionStatus.aborted // this property is not needed but it is a workaround for: https://github.com/microsoft/TypeScript/issues/7294
  artifact: Artifact
  artifactResult: AbortResult<Status>
  stepsResult: Graph<{
    stepInfo: StepInfo
    artifactStepResult: DoneResult | AbortResult<Status.skippedAsFailed | Status.skippedAsPassed>
  }>
}

export type RunningStepsResultOfArtifact = {
  artifactExecutionStatus: ExecutionStatus.running // this property is not needed but it is a workaround for: https://github.com/microsoft/TypeScript/issues/7294
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
  artifactExecutionStatus: ExecutionStatus.scheduled // this property is not needed but it is a workaround for: https://github.com/microsoft/TypeScript/issues/7294
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

// ------------------------

export type CanRunStepOnArtifactResult =
  | {
      canRun: true
      artifactStepResult: {
        notes: Array<string>
        errors?: Array<ErrorObject>
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

// ------------------------

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
    notes: Array<string>
    errors?: Array<ErrorObject>
  }
  artifactsResult: Array<UserArtifactResult>
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

export enum RunStrategy {
  perArtifact = 'per-artifact',
  allArtifacts = 'all-artfifacts',
  root = 'root',
}

export type Run<StepConfigurations> = {
  onStepDone?: (options: UserRunStepOptions<StepConfigurations>) => Promise<void>
} & (
  | {
      runStrategy: RunStrategy.perArtifact
      beforeAll?: (options: UserRunStepOptions<StepConfigurations>) => Promise<void>
      runStepOnArtifact: RunStepOnArtifact<StepConfigurations>
      afterAll?: (options: UserRunStepOptions<StepConfigurations>) => Promise<void>
    }
  | {
      runStrategy: RunStrategy.allArtifacts
      runStepOnArtifacts: RunStepOnArtifacts<StepConfigurations>
    }
  | {
      runStrategy: RunStrategy.root
      runStepOnRoot: RunStepOnRoot<StepConfigurations>
    }
)

export type CreateStepOptions<StepConfigurations, NormalizedStepConfigurations = StepConfigurations> = {
  stepName: string
  normalizeStepConfigurations?: (stepConfigurations: StepConfigurations) => Promise<NormalizedStepConfigurations>
  runIfAllConstrainsApply?: {
    canRunStep?: Array<StepConstrain<NormalizedStepConfigurations>>
    canRunStepOnArtifact?: Array<ArtifactInStepConstrain<NormalizedStepConfigurations>>
  }
  run: Run<NormalizedStepConfigurations>
}
