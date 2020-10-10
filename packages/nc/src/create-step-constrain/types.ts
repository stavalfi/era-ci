import { ErrorObject } from 'serialize-error'
import { UserRunStepOptions } from '../create-step'
import { AbortResult, ConstrainResult, Status } from '../types'

export type StepConstrainResult =
  | {
      constrainResult: ConstrainResult.shouldRun
      stepResult: {
        notes: Array<string>
        errors: Array<ErrorObject>
      }
    }
  | {
      constrainResult: ConstrainResult.ignoreThisConstrain
      stepResult: {
        notes: Array<string>
        errors: Array<ErrorObject>
      }
    }
  | {
      constrainResult: ConstrainResult.shouldSkip
      stepResult: Omit<AbortResult<Status.skippedAsFailed | Status.skippedAsPassed>, 'durationMs'>
    }

export type CombinedStepConstrainResult =
  | {
      constrainResult: ConstrainResult.shouldRun
      stepResult: {
        notes: Array<string>
        errors: Array<ErrorObject>
      }
    }
  | {
      constrainResult: ConstrainResult.shouldSkip
      stepResult: Omit<AbortResult<Status.skippedAsFailed | Status.skippedAsPassed>, 'durationMs'>
    }

export type StepConstrain<StepConfiguration> = {
  constrainName: string
  callConstrain: (options: {
    userRunStepOptions: UserRunStepOptions<StepConfiguration>
  }) => Promise<StepConstrainResult>
}
