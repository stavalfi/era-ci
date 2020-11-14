import { ErrorObject } from 'serialize-error'
import { UserRunStepOptions } from '../create-step'
import { AbortResult, Artifact, ConstrainResult, Node, Status } from '../types'

export type ArtifactInStepConstrainResult =
  | {
      constrainResult: ConstrainResult.shouldRun
      artifactStepResult: {
        notes: Array<string>
        errors: Array<ErrorObject>
      }
    }
  | {
      constrainResult: ConstrainResult.ignoreThisConstrain
      artifactStepResult: {
        notes: Array<string>
        errors: Array<ErrorObject>
      }
    }
  | {
      constrainResult: ConstrainResult.shouldSkip
      artifactStepResult: Omit<AbortResult<Status.skippedAsFailed | Status.skippedAsPassed>, 'durationMs'>
    }

export type CombinedArtifactInStepConstrainResult =
  | {
      constrainResult: ConstrainResult.shouldRun
      artifactStepResult: {
        notes: Array<string>
        errors: Array<ErrorObject>
      }
    }
  | {
      constrainResult: ConstrainResult.shouldSkip
      artifactStepResult: Omit<AbortResult<Status.skippedAsFailed | Status.skippedAsPassed>, 'durationMs'>
    }

export type ArtifactInStepConstrain<StepConfiguration> = {
  constrainName: string
  callConstrain: (
    options: {
      userRunStepOptions: Omit<UserRunStepOptions<never, never, StepConfiguration>, 'taskQueue'>
    } & { currentArtifact: Node<{ artifact: Artifact }> },
  ) => Promise<ArtifactInStepConstrainResult>
}
