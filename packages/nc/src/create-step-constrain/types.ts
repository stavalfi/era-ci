import { ErrorObject } from 'serialize-error'
import { UserRunStepOptions } from '../create-step'
import { AbortResult, Status } from '../types'

export type StepConstrainResult =
  | {
      canRun: true
      stepResult: {
        notes: Array<string>
        errors: Array<ErrorObject>
      }
    }
  | {
      canRun: false
      stepResult: Omit<AbortResult<Status.skippedAsFailed | Status.skippedAsPassed>, 'durationMs'>
    }

export type StepConstrain<StepConfiguration> = {
  constrainName: string
  callConstrain: (options: {
    userRunStepOptions: UserRunStepOptions<StepConfiguration>
  }) => Promise<true | StepConstrainResult>
}
