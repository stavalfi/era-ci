import {
  AbortResult,
  Artifact,
  DoneResult,
  ExecutionStatus,
  GitRepoInfo,
  Graph,
  Node,
  PackageJson,
  RunningResult,
  ScheduledResult,
  Status,
} from '@tahini/utils'
import { Observable } from 'rxjs'
import { ErrorObject } from 'serialize-error'
import { Constrain } from '../create-constrain'
import { Log, Logger } from '../create-logger'
import { TaskQueueBase, TaskQueueOptions } from '../create-task-queue'
import { ImmutableCache } from '../immutable-cache'
import { GetState } from '../types'

export type StepInfo = {
  stepGroup: string
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
    artifactStepResult: DoneResult | AbortResult<Status.skippedAsFailed | Status.skippedAsPassed | Status.failed>
  }>
}

export type AbortStepResultOfArtifacts = {
  stepExecutionStatus: ExecutionStatus.aborted // this property is not needed but it is a workaround for: https://github.com/microsoft/TypeScript/issues/7294
  stepInfo: StepInfo
  stepResult: AbortResult<Status>
  artifactsResult: Graph<{
    artifact: Artifact
    artifactStepResult: AbortResult<Status.skippedAsFailed | Status.skippedAsPassed | Status.failed>
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
      | AbortResult<Status.skippedAsFailed | Status.skippedAsPassed | Status.failed>
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
    artifactStepResult: DoneResult | AbortResult<Status.skippedAsFailed | Status.skippedAsPassed | Status.failed>
  }>
}

export type AbortStepsResultOfArtifact = {
  artifactExecutionStatus: ExecutionStatus.aborted // this property is not needed but it is a workaround for: https://github.com/microsoft/TypeScript/issues/7294
  artifact: Artifact
  artifactResult: AbortResult<Status>
  stepsResult: Graph<{
    stepInfo: StepInfo
    artifactStepResult: AbortResult<Status.skippedAsFailed | Status.skippedAsPassed | Status.failed>
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
      | AbortResult<Status.skippedAsFailed | Status.skippedAsPassed | Status.failed>
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
  getState: GetState
  immutableCache: ImmutableCache
  logger: Logger
  taskQueue: TaskQueue
  processEnv: NodeJS.ProcessEnv
  gitRepoInfo: GitRepoInfo
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
  artifactStepResult: DoneResult | AbortResult<Status.skippedAsFailed | Status.skippedAsPassed | Status.failed>
}

export enum StepOutputEventType {
  artifactStep = 'output-artifact-step',
  step = 'output-step',
}

export type UserReturnValue =
  | {
      executionStatus: ExecutionStatus.aborted
      status: Status.skippedAsFailed | Status.skippedAsPassed | Status.failed
      notes?: Array<string>
      errors?: Array<ErrorObject>
      returnValue?: string
    }
  | {
      executionStatus: ExecutionStatus.done
      status: Status.passed | Status.failed
      notes?: Array<string>
      errors?: Array<ErrorObject>
      returnValue?: string
    }

export type StepOutputEvents = {
  [StepOutputEventType.artifactStep]: {
    type: StepOutputEventType.artifactStep
    artifact: Node<{ artifact: Artifact }>
    step: Node<{ stepInfo: StepInfo }>
    artifactStepResult:
      | ScheduledResult
      | RunningResult
      | AbortResult<Status.skippedAsFailed | Status.skippedAsPassed | Status.failed>
      | DoneResult
  }
  [StepOutputEventType.step]: {
    type: StepOutputEventType.step
    step: Node<{ stepInfo: StepInfo }>
    stepResult:
      | ScheduledResult
      | RunningResult
      | AbortResult<Status.skippedAsFailed | Status.skippedAsPassed | Status.failed>
      | DoneResult
  }
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
) => Promise<
  | Omit<DoneResult, 'durationMs'>
  | Omit<AbortResult<Status.skippedAsFailed | Status.skippedAsPassed | Status.failed>, 'durationMs'>
>

export type RunStepOnRoot<TaskQueue extends TaskQueueBase<unknown>, StepConfigurations> = (
  options: UserRunStepOptions<TaskQueue, StepConfigurations>,
) => Promise<
  | Omit<DoneResult, 'durationMs'>
  | Omit<AbortResult<Status.skippedAsFailed | Status.skippedAsPassed | Status.failed>, 'durationMs'>
>

export type StepFunctions<StepConfigurations> = {
  stepConstrains?: Array<Constrain<StepConfigurations>>
  stepLogic?: () => Promise<UserReturnValue | undefined | void>
}

export type ArtifactFunctions<StepConfigurations> = {
  waitUntilArtifactParentsFinishedParentSteps?: boolean
  artifactConstrains?: Array<(artifact: Node<{ artifact: Artifact }>) => Constrain<StepConfigurations>>
  onBeforeArtifacts?: () => Promise<void>
  onArtifact?: (options: { artifact: Node<{ artifact: Artifact }> }) => Promise<UserReturnValue | undefined | void>
  onAfterArtifacts?: () => Promise<void>
}

export type RunStepExperimental<TaskQueue extends TaskQueueBase<unknown>, StepConfigurations> = (
  options: UserRunStepOptions<TaskQueue, StepConfigurations>,
) =>
  | ({
      globalConstrains?: Array<Constrain<StepConfigurations>>
    } & (StepFunctions<StepConfigurations> | ArtifactFunctions<StepConfigurations>))
  | undefined
  | void

export type StepExperimental<TaskQueue extends TaskQueueBase<unknown>> = {
  stepName: string
  stepGroup: string
  taskQueueClass: { new (options: TaskQueueOptions<unknown>): TaskQueue }
  runStep: (
    runStepOptions: RunStepOptions<TaskQueue>,
    stepsEvents$: Observable<StepOutputEvents[StepOutputEventType]>,
  ) => Observable<StepOutputEvents[StepOutputEventType]>
}

export enum RunStrategy {
  perArtifact = 'per-artifact',
  allArtifacts = 'all-artfifacts',
  root = 'root',
  experimental = 'experimental',
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
  | {
      runStrategy: RunStrategy.experimental
      runStepOnRoot: RunStepOnRoot<TaskQueue, StepConfigurations>
    }
)

export type CreateStepOptionsExperimental<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TaskQueue extends TaskQueueBase<any>,
  StepConfigurations = void,
  NormalizedStepConfigurations = StepConfigurations
> = {
  stepGroup: string
  stepName: string
  normalizeStepConfigurations?: (
    stepConfigurations: StepConfigurations,
    options: RunStepOptions<TaskQueue>,
  ) => Promise<NormalizedStepConfigurations>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  taskQueueClass: { new (options: TaskQueueOptions<any>, ...params: any[]): TaskQueue }
  run: RunStepExperimental<TaskQueue, NormalizedStepConfigurations>
}
