import { ErrorObject } from 'serialize-error'
import { UserRunStepOptions } from '../create-step'
import { AbortResult, Status } from '../types'

export type CanRunStepOnArtifactsResult =
  | {
      canRun: true
      stepResult: {
        notes: Array<string>
        errors?: Array<ErrorObject>
      }
    }
  | {
      canRun: false
      stepResult: Omit<AbortResult<Status.skippedAsFailed | Status.skippedAsPassed>, 'durationMs'>
    }

export type CanRunStepOnArtifactsPredicate = {
  predicateName: string
  callPredicate: (
    options: Omit<UserRunStepOptions<never>, 'stepConfigurations'>,
  ) => Promise<true | CanRunStepOnArtifactsResult>
}
