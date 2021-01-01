import { AbortResult, Status } from '@era-ci/utils'
import { ErrorObject } from 'serialize-error'
import { UserRunStepOptions } from '../create-step'

export enum ConstrainResultType {
  shouldRun = 'should-run',
  shouldSkip = 'should-skip',
  ignoreThisConstrain = 'ignore-this-constrain',
}

export type ConstrainResultBase =
  | {
      // it means that this constrain decided not to skip this artifact/step
      // so we need to find other constrain that will decide to skip
      resultType: ConstrainResultType.ignoreThisConstrain
      result: {
        notes: Array<string>
        errors: Array<ErrorObject>
      }
    }
  | {
      resultType: ConstrainResultType.shouldSkip
      result: Omit<AbortResult<Status.skippedAsFailed | Status.skippedAsPassed>, 'durationMs' | 'returnValue'>
    }

export type ConstrainResult = {
  constrainName: string
  constrainOptions: unknown
} & ConstrainResultBase

export type CombinedConstrainResultShouldRun = {
  individualResults: Array<ConstrainResult>
  combinedResultType: ConstrainResultType.shouldRun
  combinedResult: {
    notes: Array<string>
    errors: Array<ErrorObject>
  }
}

export type CombinedConstrainResultShouldSkip = {
  individualResults: Array<ConstrainResult>
  combinedResultType: ConstrainResultType.shouldSkip
  combinedResult: Omit<AbortResult<Status.skippedAsFailed | Status.skippedAsPassed>, 'durationMs' | 'returnValue'>
}

export type CombinedConstrainResult = CombinedConstrainResultShouldRun | CombinedConstrainResultShouldSkip

export type Constrain<StepConfiguration> = {
  constrainName: string
  callConstrain: (options: {
    userRunStepOptions: Omit<UserRunStepOptions<never, StepConfiguration>, 'taskQueue'>
  }) => Promise<{
    constrainOptions: unknown
    invoke: () => Promise<ConstrainResult>
  }>
}
