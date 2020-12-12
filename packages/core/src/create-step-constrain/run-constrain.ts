import _ from 'lodash'
import { ErrorObject, serializeError } from 'serialize-error'
import { UserRunStepOptions } from '../create-step'
import { ConstrainResultType, ExecutionStatus, Status, calculateCombinedStatus } from '@tahini/utils'
import { CombinedStepConstrainResult, StepConstrain, StepConstrainResult } from './types'

export async function runConstrains<StepConfiguration>({
  predicates,
  userRunStepOptions,
}: {
  userRunStepOptions: Omit<UserRunStepOptions<never, StepConfiguration>, 'taskQueue'>
  predicates: Array<StepConstrain<StepConfiguration>>
}): Promise<CombinedStepConstrainResult> {
  const results = await Promise.all(
    predicates.map(async p => {
      const { constrainOptions, invoke } = await p.callConstrain({ userRunStepOptions })
      return invoke().catch<StepConstrainResult>(error => ({
        constrainName: p.constrainName,
        resultType: ConstrainResultType.shouldSkip,
        stepResult: {
          executionStatus: ExecutionStatus.aborted,
          status: Status.skippedAsFailed,
          notes: [],
          errors: [serializeError(error)],
        },
        constrainOptions,
      }))
    }),
  )
  const canRun = results.every(x =>
    [ConstrainResultType.shouldRun, ConstrainResultType.ignoreThisConstrain].includes(x.resultType),
  )
  const notes = _.uniq(_.flatMapDeep(results.map(x => x.stepResult.notes)))
  const errors = _.flatMapDeep<ErrorObject>(results.map(x => x.stepResult.errors))
  if (canRun) {
    return {
      resultType: ConstrainResultType.shouldRun,
      stepResult: {
        notes,
        errors,
      },
      constrainsResult: results,
    }
  } else {
    const artifactStepResultStatus = calculateCombinedStatus(
      _.flatMapDeep(
        results.map(r => (r.resultType === ConstrainResultType.shouldSkip ? [r.stepResult.status] : [])),
      ),
    )
    return {
      resultType: ConstrainResultType.shouldSkip,
      stepResult: {
        notes,
        executionStatus: ExecutionStatus.aborted,
        status: artifactStepResultStatus,
        errors,
      },
      constrainsResult: results,
    }
  }
}
