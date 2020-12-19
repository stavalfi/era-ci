import { calculateCombinedStatus, ExecutionStatus, Status } from '@tahini/utils'
import _ from 'lodash'
import { ErrorObject, serializeError } from 'serialize-error'
import { LogLevel } from '../create-logger'
import { UserRunStepOptions } from '../create-step'
import { CombinedConstrainResult, Constrain, ConstrainResult, ConstrainResultType } from './types'

export function getCombinedResult(individualConstrainsResults: ConstrainResult[]): CombinedConstrainResult {
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

export const runConstrains = async <StepConfiguration>(
  options: Omit<UserRunStepOptions<never, StepConfiguration>, 'taskQueue'> & {
    constrains: Array<Constrain<StepConfiguration>>
    artifactName?: string
  },
): Promise<CombinedConstrainResult> => {
  const stepConstrainsResults = await Promise.all(
    options.constrains.map(async c => {
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

  const combinedResult = getCombinedResult(stepConstrainsResults)

  let base = `step: "${options.currentStepInfo.data.stepInfo.displayName}"`
  if (options.artifactName) {
    base += `, artifact: "${options.artifactName}"`
  }
  options.log.trace(`${base} - global-constrains result: "${combinedResult.combinedResultType}"`, {
    ...(combinedResult.combinedResult.notes.length > 0 && { notes: combinedResult.combinedResult.notes }),
    ...(combinedResult.individualResults.length > 0 && {
      individualResults: combinedResult.individualResults.map(individualResult => {
        const base = `${individualResult.constrainName} - ${individualResult.resultType}`
        return individualResult.result.notes.length > 0
          ? `${base} - notes: [${individualResult.result.notes.join(', ')}]`
          : base
      }),
    }),
  })
  if (options.log.logLevel === LogLevel.trace) {
    combinedResult.combinedResult.errors.forEach(error =>
      options.log.error(`${base} - global-constrains error:`, error),
    )
  }

  return combinedResult
}
