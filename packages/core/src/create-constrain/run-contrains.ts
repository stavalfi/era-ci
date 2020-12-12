import { Artifact, calculateCombinedStatus, ExecutionStatus, Node, Status } from '@tahini/utils'
import _ from 'lodash'
import { ErrorObject, serializeError } from 'serialize-error'
import { UserRunStepOptions } from '../create-step'
import { CombinedConstrainResult, Constrain, ConstrainResult, ConstrainResultType, RunConstrains } from './types'

function getCombinedResult(individualConstrainsResults: ConstrainResult[]): CombinedConstrainResult {
  const canRun = individualConstrainsResults.every(x =>
    [ConstrainResultType.shouldRun, ConstrainResultType.ignoreThisConstrain].includes(x.resultType),
  )

  const notes = _.uniq(_.flatMapDeep(individualConstrainsResults.map(r => r.result.notes)))
  const errors = _.flatMapDeep<ErrorObject>(individualConstrainsResults.map(r => r.result.errors))

  return canRun
    ? {
        combinedResultType: ConstrainResultType.shouldRun,
        combinedResult: {
          notes,
          errors,
        },
        individualResults: individualConstrainsResults,
      }
    : {
        combinedResultType: ConstrainResultType.shouldSkip,
        combinedResult: {
          notes,
          errors,
          executionStatus: ExecutionStatus.aborted,
          status: calculateCombinedStatus(
            _.flatMapDeep(
              individualConstrainsResults.map(r =>
                r.resultType === ConstrainResultType.shouldSkip ? [r.result.status] : [],
              ),
            ),
          ),
        },
        individualResults: individualConstrainsResults,
      }
}

export const prepareRunConstrains = <StepConfiguration>(
  options: Omit<UserRunStepOptions<never, StepConfiguration>, 'taskQueue'>,
): RunConstrains<StepConfiguration> => async (constrains): Promise<CombinedConstrainResult> => {
  const stepConstrainsResults = await Promise.all(
    constrains.map(async c => {
      const { invoke, constrainOptions } = await c.callConstrain({ userRunStepOptions: options })
      return invoke().catch<ConstrainResult>(error => ({
        constrainName: c.constrainName,
        resultType: ConstrainResultType.shouldSkip,
        result: {
          executionStatus: ExecutionStatus.aborted,
          status: Status.skippedAsFailed,
          notes: [],
          errors: [serializeError(error)],
        },
        constrainOptions,
      }))
    }),
  )

  return getCombinedResult(stepConstrainsResults)
}
