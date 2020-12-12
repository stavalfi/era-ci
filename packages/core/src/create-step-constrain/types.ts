import { ErrorObject } from 'serialize-error'
import { UserRunStepOptions } from '../create-step'
import { AbortResult, ConstrainResultType, Status } from '@tahini/utils'

export type StepConstrainResultBase =
  | {
      // it means that this constrain decided not to skip this step
      // so we need to find other constrain that will decide to skip
      resultType: ConstrainResultType.ignoreThisConstrain
      stepResult: {
        notes: Array<string>
        errors: Array<ErrorObject>
      }
    }
  | {
      resultType: ConstrainResultType.shouldSkip
      stepResult: Omit<AbortResult<Status.skippedAsFailed | Status.skippedAsPassed | Status.failed>, 'durationMs'>
    }

export type StepConstrainResult = {
  constrainName: string
  constrainOptions: unknown
} & StepConstrainResultBase

export type CombinedStepConstrainResult = { constrainsResult: Array<StepConstrainResult> } & (
  | {
      resultType: ConstrainResultType.shouldRun
      stepResult: {
        notes: Array<string>
        errors: Array<ErrorObject>
      }
    }
  | {
      resultType: ConstrainResultType.shouldSkip
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
