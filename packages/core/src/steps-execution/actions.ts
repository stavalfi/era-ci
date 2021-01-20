import {
  AbortResult,
  Artifact,
  DoneResult,
  Node,
  RunningResult,
  ScheduledResult,
  Status,
  StepInfo,
} from '@era-ci/utils'

export enum ExecutionActionTypes {
  artifactStep = 'output-artifact-step',
  step = 'output-step',
}

export type ChangeArtifactStatusAction = {
  type: ExecutionActionTypes.artifactStep
  payload: {
    artifact: Node<{ artifact: Artifact }>
    step: Node<{ stepInfo: StepInfo }>
    artifactStepResult:
      | ScheduledResult
      | RunningResult
      | AbortResult<Status.skippedAsFailed | Status.skippedAsPassed | Status.failed>
      | DoneResult
  }
}

export type ChangeStepStatusAction = {
  type: ExecutionActionTypes.step
  payload: {
    step: Node<{ stepInfo: StepInfo }>
    stepResult:
      | ScheduledResult
      | RunningResult
      | AbortResult<Status.skippedAsFailed | Status.skippedAsPassed | Status.failed>
      | DoneResult
  }
}

export type Actions = ChangeArtifactStatusAction | ChangeStepStatusAction
