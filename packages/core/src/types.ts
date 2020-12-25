import { AbortResult, DoneResult, RunningResult, ScheduledResult, Status } from '@tahini/utils'
import { StepsResultOfArtifactsByArtifact, StepsResultOfArtifactsByStep } from './create-step'

export type State = {
  stepsResultOfArtifactsByStep: StepsResultOfArtifactsByStep
  stepsResultOfArtifactsByArtifact: StepsResultOfArtifactsByArtifact
  getResult: (
    options: {
      artifactName: string
    } & ({ stepId: string } | { stepGroup: string }),
  ) =>
    | ScheduledResult
    | RunningResult
    | DoneResult
    | AbortResult<Status.skippedAsFailed | Status.skippedAsPassed | Status.failed>
  getReturnValue: <T = string>(
    options: { artifactName: string; mapper: (val?: string) => T; allowUndefined?: boolean } & (
      | { stepId: string }
      | { stepGroup: string }
    ),
  ) => T
}

export type GetState = () => State
