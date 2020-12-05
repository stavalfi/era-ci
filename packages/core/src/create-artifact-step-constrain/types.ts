import { ErrorObject } from 'serialize-error'
import { UserRunStepOptions } from '../create-step'
import { AbortResult, Artifact, ConstrainResult, Node, Status } from '@tahini/utils'

export type ArtifactInStepConstrainResultBase =
  | {
      // it means that this constrain decided not to skip this artifact
      // so we need to find other constrain that will decide to skip
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

export type ArtifactInStepConstrainResult = {
  constrainName: string
  constrainOptions: unknown
} & ArtifactInStepConstrainResultBase

export type CombinedArtifactInStepConstrainResult = { constrainsResult: Array<ArtifactInStepConstrainResult> } & (
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
)

export type ArtifactInStepConstrain<StepConfiguration> = {
  constrainName: string
  callConstrain: (
    options: {
      userRunStepOptions: Omit<UserRunStepOptions<never, StepConfiguration>, 'taskQueue'>
    } & { currentArtifact: Node<{ artifact: Artifact }> },
  ) => Promise<{
    constrainOptions: unknown
    invoke: () => Promise<ArtifactInStepConstrainResult>
  }>
}
