import { ErrorObject } from 'serialize-error'
import { UserRunStepOptions } from '../create-step'
import { AbortResult, ConstrainResult, Status } from '@tahini/utils'

export type StepConstrainResultBase =
  | {
      // it means that this constrain decided not to skip this step
      // so we need to find other constrain that will decide to skip
      constrainResult: ConstrainResult.ignoreThisConstrain
      stepResult: {
        notes: Array<string>
        errors: Array<ErrorObject>
      }
    }
  | {
      constrainResult: ConstrainResult.shouldSkip
      stepResult: Omit<AbortResult<Status.skippedAsFailed | Status.skippedAsPassed | Status.failed>, 'durationMs'>
    }

export type StepConstrainResult = {
  constrainName: string
  constrainOptions: unknown
} & StepConstrainResultBase

export type CombinedStepConstrainResult = { constrainsResult: Array<StepConstrainResult> } & (
  | {
      constrainResult: ConstrainResult.shouldRun
      stepResult: {
        notes: Array<string>
        errors: Array<ErrorObject>
      }
    }
  | {
      constrainResult: ConstrainResult.shouldSkip
      stepResult: Omit<AbortResult<Status.skippedAsFailed | Status.skippedAsPassed | Status.failed>, 'durationMs'>
    }
)

export type StepConstrain<StepConfiguration> = {
  constrainName: string
  callConstrain: (options: {
    userRunStepOptions: Omit<UserRunStepOptions<never, StepConfiguration>, 'taskQueue'>
  }) => Promise<{
    constrainOptions: unknown
    invoke: () => Promise<StepConstrainResult>
  }>
}
