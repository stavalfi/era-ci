import { Cache } from '../create-cache'
import { Log, Logger } from '../create-logger'
import { Artifact, Graph, Node, PackageJson } from '../types'

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

export type Result<ErrorType> = {
  status: Status
  durationMs: number
  notes: string[]
  error?: ErrorType
}

export type StepResultOfArtifacts<ErrorType> = {
  stepInfo: StepInfo
} & (
  | {
      stepExecutionStatus: ExecutionStatus.done
      stepResult: Result<ErrorType>
      artifactsResult: Graph<{
        artifact: Artifact
        artifactStepExecutionStatus: ExecutionStatus.done
        artifactStepResult: Result<ErrorType>
      }>
    }
  | {
      stepExecutionStatus: ExecutionStatus.running | ExecutionStatus.aborted
      artifactsResult: Graph<
        { artifact: Artifact } & (
          | {
              artifactStepExecutionStatus: ExecutionStatus.done
              artifactStepResult: Result<ErrorType>
            }
          | {
              artifactStepExecutionStatus: ExecutionStatus.running | ExecutionStatus.aborted | ExecutionStatus.scheduled
            }
        )
      >
    }
  | {
      stepExecutionStatus: ExecutionStatus.scheduled
    }
)

export type StepsResultOfArtifactsByStep<ErrorType> = Graph<StepResultOfArtifacts<ErrorType>>

export type StepsResultOfArtifact<ErrorType> = {
  artifact: Artifact
} & (
  | {
      artifactExecutionStatus: ExecutionStatus.done
      artifactResult: Result<ErrorType>
      stepsResult: Graph<{
        stepInfo: StepInfo
        artifactStepExecutionStatus: ExecutionStatus.done
        artifactStepResult: Result<ErrorType>
      }>
    }
  | {
      artifactExecutionStatus: ExecutionStatus.running | ExecutionStatus.aborted
      stepsResult: Graph<
        { stepInfo: StepInfo } & (
          | {
              artifactStepExecutionStatus: ExecutionStatus.done
              artifactStepResult: Result<ErrorType>
            }
          | {
              artifactStepExecutionStatus: ExecutionStatus.running | ExecutionStatus.aborted | ExecutionStatus.scheduled
            }
        )
      >
    }
  | {
      artifactExecutionStatus: ExecutionStatus.scheduled
    }
)

export type StepsResultOfArtifactsByArtifact<ErrorType> = Graph<StepsResultOfArtifact<ErrorType>>

export type CanRunStepOnArtifactResult =
  | {
      canRun: true
      notes: string[]
    }
  | {
      canRun: false
      notes: string[]
      stepStatus: Status
    }

export type CanRunStepOnArtifact<StepConfigurations> = {
  customPredicate?: (
    options: UserRunStepOptions<StepConfigurations> & { currentArtifact: Node<{ artifact: Artifact }> },
  ) => Promise<CanRunStepOnArtifactResult>
  options?: {
    skipIfSomeDirectPrevStepsFailedOnPackage?: boolean
    skipIfPackageResultsInCache?: boolean
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
  stepsResultOfArtifactsByStep: StepsResultOfArtifactsByStep<unknown>
  stepsResultOfArtifactsByArtifact: StepsResultOfArtifactsByArtifact<unknown>
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
  stepResult: Result<unknown>
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
) => Promise<Omit<Result<unknown>, 'durationMs'>>

export type RunStepOnRoot<StepConfigurations> = (
  options: UserRunStepOptions<StepConfigurations>,
) => Promise<Omit<Result<unknown>, 'durationMs'>>

export type Step = {
  stepName: string
  runStep: (runStepOptions: RunStepOptions) => Promise<StepResultOfArtifacts<unknown>>
}

export type CreateStepOptions<StepConfigurations, NormalizedStepConfigurations = StepConfigurations> = {
  stepName: string
  normalizeStepConfigurations?: (stepConfigurations: StepConfigurations) => Promise<NormalizedStepConfigurations>
  canRunStepOnArtifact?: CanRunStepOnArtifact<NormalizedStepConfigurations>
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
