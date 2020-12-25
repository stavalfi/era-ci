import { AbortResult, DoneResult, RunningResult, ScheduledResult, Status } from '@tahini/utils'
import { StepsResultOfArtifactsByArtifact, StepsResultOfArtifactsByStep } from './create-step'

export type State = {
  stepsResultOfArtifactsByStep: StepsResultOfArtifactsByStep
  stepsResultOfArtifactsByArtifact: StepsResultOfArtifactsByArtifact
  getResult: (options: {
    artifactName: string
    stepId: string
  }) =>
    | ScheduledResult
    | RunningResult
    | DoneResult
    | AbortResult<Status.skippedAsFailed | Status.skippedAsPassed | Status.failed>
}

export type GetState = () => State
