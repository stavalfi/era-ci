import { calculateCombinedStatus, ExecutionStatus, Status } from '@era-ci/utils'
import _ from 'lodash'
import { ErrorObject, serializeError } from 'serialize-error'
import { UserRunStepOptions } from '../create-step'
import { CombinedConstrainResult, Constrain, ConstrainResult, ConstrainResultType } from './types'

export function getCombinedResult(individualConstrainsResults: ConstrainResult[]): CombinedConstrainResult {
  const shouldSkipAsPassedConstrains = individualConstrainsResults.filter(
    c => c.resultType === ConstrainResultType.shouldSkip && c.result.status === Status.skippedAsPassed,
  )
  const ignoreConstrains = individualConstrainsResults.filter(
    c => c.resultType === ConstrainResultType.ignoreThisConstrain,
  )
  if (shouldSkipAsPassedConstrains.length > 0) {
    // if there are some constrains which identified a problem and choose to skip-as-passed,
    // we prefer to "ignore" the results of the other constrains (even if they chose to skip-as-fail)
    // USECASE: quay-docker-publish step is disabled and git repo is dirty,
    // so it should skip as passed but because the git-repo is dirty, it will skip as failed.
    const combined = [...shouldSkipAsPassedConstrains, ...ignoreConstrains]
    const notes = _.uniq(_.flatMapDeep(combined.map(r => r.result.notes)))
    const errors = _.flatMapDeep<ErrorObject>(combined.map(r => r.result.errors))

    return {
      combinedResultType: ConstrainResultType.shouldSkip,
      combinedResult: {
        notes,
        errors,
        executionStatus: ExecutionStatus.aborted,
        status: Status.skippedAsPassed,
      },
      individualResults: combined,
    }
  }

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
    logPrefix: string
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

  let base = `[${options.logPrefix}]`
  if (options.artifactName) {
    base += ` artifact: "${options.artifactName}"`
  }
  options.log.trace(`${base} - result: "${combinedResult.combinedResultType}"`, {
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

  return combinedResult
}
