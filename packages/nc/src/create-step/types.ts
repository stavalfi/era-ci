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

export type Result<StatusType> = {
  status: StatusType
  durationMs: number
  notes: string[]
  error?: ErrorObject
}

export type StepResultOfArtifacts = {
  stepInfo: StepInfo
} & (
  | {
      stepExecutionStatus: ExecutionStatus.done
      stepResult: Result<Status.passed | Status.failed>
      artifactsResult: Graph<{
        artifact: Artifact
        artifactStepExecutionStatus: ExecutionStatus.done
        artifactStepResult: Result<Status.passed | Status.failed>
      }>
    }
  | {
      stepExecutionStatus: ExecutionStatus.aborted
      // stepResult depends if any artifact run (as passed/failed) or not. it's weird to say that stepResult=skipped but some artifact(s) has passed/failed.
      stepResult: Result<Status>
      artifactsResult: Graph<
        { artifact: Artifact } & (
          | {
              artifactStepExecutionStatus: ExecutionStatus.done
              artifactStepResult: Result<Status.passed | Status.failed>
            }
          | {
              artifactStepExecutionStatus: ExecutionStatus.aborted
              artifactStepResult: Result<Status.skippedAsFailed | Status.skippedAsPassed>
            }
        )
      >
    }
  | {
      stepExecutionStatus: ExecutionStatus.running
      artifactsResult: Graph<
        { artifact: Artifact } & (
          | {
              artifactStepExecutionStatus: ExecutionStatus.done
              artifactStepResult: Result<Status.passed | Status.failed>
            }
          | {
              artifactStepExecutionStatus: ExecutionStatus.aborted
              artifactStepResult: Result<Status.skippedAsFailed | Status.skippedAsPassed>
            }
          | {
              artifactStepExecutionStatus: ExecutionStatus.running | ExecutionStatus.scheduled
              artifactStepResult: Graph<{ artifact: Artifact }>
            }
        )
      >
    }
  | {
      stepExecutionStatus: ExecutionStatus.scheduled
      artifactsResult: Graph<{ artifact: Artifact; artifactStepExecutionStatus: ExecutionStatus.scheduled }>
    }
)

export type StepsResultOfArtifactsByStep = Graph<StepResultOfArtifacts>

export type StepsResultOfArtifact = {
  artifact: Artifact
} & (
  | {
      artifactExecutionStatus: ExecutionStatus.done
      artifactResult: Result<Status.passed | Status.failed>
      stepsResult: Graph<{
        stepInfo: StepInfo
        artifactStepExecutionStatus: ExecutionStatus.done
        artifactStepResult: Result<Status.passed | Status.failed>
      }>
    }
  | {
      artifactExecutionStatus: ExecutionStatus.aborted
      // artifactResult depends if any step run (as passed/failed) or not. it's weird to say that artifactResult=skipped but some step(s) has passed/failed.
      artifactResult: Result<Status>
      stepsResult: Graph<
        {
          stepInfo: StepInfo
        } & (
          | {
              artifactStepExecutionStatus: ExecutionStatus.done
              artifactStepResult: Result<Status.passed | Status.failed>
            }
          | {
              artifactStepExecutionStatus: ExecutionStatus.aborted
              artifactStepResult: Result<Status.skippedAsFailed | Status.skippedAsPassed>
            }
        )
      >
    }
  | {
      artifactExecutionStatus: ExecutionStatus.running
      stepsResult: Graph<
        { stepInfo: StepInfo } & (
          | {
              artifactStepExecutionStatus: ExecutionStatus.done
              artifactStepResult: Result<Status.passed | Status.failed>
            }
          | {
              artifactStepExecutionStatus: ExecutionStatus.aborted
              artifactStepResult: Result<Status.skippedAsFailed | Status.skippedAsPassed>
            }
          | {
              artifactStepExecutionStatus: ExecutionStatus.running | ExecutionStatus.scheduled
              artifactStepResult: Graph<{ artifact: Artifact }>
            }
        )
      >
    }
  | {
      artifactExecutionStatus: ExecutionStatus.scheduled
      stepsResult: Graph<{ stepInfo: StepInfo; artifactStepExecutionStatus: ExecutionStatus.scheduled }>
    }
)

export type StepsResultOfArtifactsByArtifact = Graph<StepsResultOfArtifact>

export type CanRunStepOnArtifactResult =
  | {
      canRun: true
      notes: string[]
    }
  | {
      canRun: false
      notes: string[]
      stepStatus: Status.skippedAsFailed | Status.skippedAsPassed
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
  stepResult: Result<Status>
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
) => Promise<Omit<Result<Status>, 'durationMs'>>

export type RunStepOnRoot<StepConfigurations> = (
  options: UserRunStepOptions<StepConfigurations>,
) => Promise<Omit<Result<Status>, 'durationMs'>>

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
