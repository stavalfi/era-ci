import { ErrorObject } from 'serialize-error'
import { ArtifactInStepConstrain } from '../create-artifact-step-constrain'
import { Log, Logger } from '../create-logger'
import { StepConstrain } from '../create-step-constrain'
import { TaskQueueBase, TaskQueueOptions } from '../create-task-queue'
import { ImmutableCache } from '../immutable-cache'
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
  stepResult: AbortResult<Status.failed | Status.passed | Status.skippedAsFailed | Status.skippedAsPassed>
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
  artifactResult: AbortResult<Status.failed | Status.passed | Status.skippedAsFailed | Status.skippedAsPassed>
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

export type RunStepOptions<TaskQueue extends TaskQueueBase<unknown>> = {
  flowId: string
  repoHash: string
  startFlowMs: number
  repoPath: string
  rootPackageJson: PackageJson
  artifacts: Graph<{ artifact: Artifact }>
  steps: Graph<{ stepInfo: StepInfo }>
  currentStepInfo: Node<{ stepInfo: StepInfo }>
  stepsResultOfArtifactsByStep: StepsResultOfArtifactsByStep
  stepsResultOfArtifactsByArtifact: StepsResultOfArtifactsByArtifact
  immutableCache: ImmutableCache
  logger: Logger
  taskQueue: TaskQueue
}

export type UserRunStepOptions<TaskQueue extends TaskQueueBase<unknown>, StepConfigurations> = RunStepOptions<
  TaskQueue
> & {
  log: Log
  stepConfigurations: StepConfigurations
  startStepMs: number
}

export type UserArtifactResult = {
  artifactName: string
  artifactStepResult: DoneResult | AbortResult<Status.skippedAsFailed | Status.skippedAsPassed>
}

export type UserStepResult = {
  stepResult: {
    notes: Array<string>
    errors: Array<ErrorObject>
  }
  artifactsResult: Array<UserArtifactResult>
}

export type RunStepOnArtifacts<TaskQueue extends TaskQueueBase<unknown>, StepConfigurations> = (
  options: UserRunStepOptions<TaskQueue, StepConfigurations>,
) => Promise<UserStepResult>

export type RunStepOnArtifact<TaskQueue extends TaskQueueBase<unknown>, StepConfigurations> = (
  options: UserRunStepOptions<TaskQueue, StepConfigurations> & {
    currentArtifact: Node<{ artifact: Artifact }>
  },
) => Promise<Omit<DoneResult, 'durationMs'>>

export type RunStepOnRoot<TaskQueue extends TaskQueueBase<unknown>, StepConfigurations> = (
  options: UserRunStepOptions<TaskQueue, StepConfigurations>,
) => Promise<Omit<DoneResult, 'durationMs'>>

export type Step<TaskQueue extends TaskQueueBase<unknown>> = {
  stepName: string
  taskQueueClass: { new (options: TaskQueueOptions<unknown>): TaskQueue }
  runStep: (runStepOptions: RunStepOptions<TaskQueue>) => Promise<StepResultOfArtifacts>
}

export enum RunStrategy {
  perArtifact = 'per-artifact',
  allArtifacts = 'all-artfifacts',
  root = 'root',
}

export type Run<TaskQueue extends TaskQueueBase<unknown>, StepConfigurations> = {
  onStepDone?: (options: UserRunStepOptions<TaskQueue, StepConfigurations>) => Promise<void>
} & (
  | {
      runStrategy: RunStrategy.perArtifact
      beforeAll?: (options: UserRunStepOptions<TaskQueue, StepConfigurations>) => Promise<void>
      runStepOnArtifact: RunStepOnArtifact<TaskQueue, StepConfigurations>
      afterAll?: (options: UserRunStepOptions<TaskQueue, StepConfigurations>) => Promise<void>
    }
  | {
      runStrategy: RunStrategy.allArtifacts
      runStepOnArtifacts: RunStepOnArtifacts<TaskQueue, StepConfigurations>
    }
  | {
      runStrategy: RunStrategy.root
      runStepOnRoot: RunStepOnRoot<TaskQueue, StepConfigurations>
    }
)

export type CreateStepOptions<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TaskQueue extends TaskQueueBase<any>,
  StepConfigurations = void,
  NormalizedStepConfigurations = StepConfigurations
> = {
  stepName: string
  normalizeStepConfigurations?: (stepConfigurations: StepConfigurations) => Promise<NormalizedStepConfigurations>
  constrains?: {
    onStep?: Array<StepConstrain<NormalizedStepConfigurations>>
    onArtifact?: Array<ArtifactInStepConstrain<NormalizedStepConfigurations>>
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  taskQueueClass: { new (options: TaskQueueOptions<any>): TaskQueue }
  run: Run<TaskQueue, NormalizedStepConfigurations>
}
