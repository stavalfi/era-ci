import { ErrorObject } from 'serialize-error'
import { UserRunStepOptions } from '../create-step'
import { AbortResult, Artifact, Node, Status } from '../types'

export type ArtifactInStepConstrainResult =
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

export type ArtifactInStepConstrain<StepConfiguration> = {
  constrainName: string
  callConstrain: (
    options: {
      userRunStepOptions: UserRunStepOptions<StepConfiguration>
    } & { currentArtifact: Node<{ artifact: Artifact }> },
  ) => Promise<true | ArtifactInStepConstrainResult>
}
