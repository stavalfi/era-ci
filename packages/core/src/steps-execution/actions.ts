import { StepOutputEvents, StepOutputEventType } from '@era-ci/utils'

export type ChangeArtifactStatusAction = {
  type: StepOutputEventType.artifactStep
  payload: StepOutputEvents[StepOutputEventType.artifactStep]
}

export type ChangeStepStatusAction = {
  type: StepOutputEventType.step
  payload: StepOutputEvents[StepOutputEventType.step]
}

export type Actions = ChangeArtifactStatusAction | ChangeStepStatusAction
