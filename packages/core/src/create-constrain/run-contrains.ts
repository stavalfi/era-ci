import { Artifact, calculateCombinedStatus, ExecutionStatus, Node, Status } from '@tahini/utils'
import _ from 'lodash'
import { ErrorObject, serializeError } from 'serialize-error'
import { UserRunStepOptions } from '../create-step'
import { CombinedConstrainResult, Constrain, ConstrainResult, ConstrainResultType, RunConstrainsResult } from './types'

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

export async function runConstrains<StepConfiguration>({
  options,
  stepConstrains = [],
}: {
  options: Omit<UserRunStepOptions<never, StepConfiguration>, 'taskQueue'>
  stepConstrains?: Array<Constrain<StepConfiguration>>
  artifactConstrains?: Array<(currentArtifact: Node<{ artifact: Artifact }>) => Constrain<StepConfiguration>>
}): Promise<RunConstrainsResult> {
  const [stepConstrainsResults, artifactsConstrainsResults] = await Promise.all([
    Promise.all(
      stepConstrains.map(async c => {
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
    ),
    Promise.all(
      options.artifacts.map(artifact =>
        Promise.all(
          artifactConstrains.map(async prepareConstrain => {
            const c = prepareConstrain(artifact)
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
        ),
      ),
    ),
  ])

  const stepConstrainsResult = getCombinedResult(stepConstrainsResults)
  const artifactConstrainsResult = artifactsConstrainsResults.map(getCombinedResult)
  const combinedResultType = artifactConstrainsResult.every(x =>
    [ConstrainResultType.shouldRun, ConstrainResultType.ignoreThisConstrain].includes(x.combinedResultType),
  )

  return {
    combinedResultType: combinedResultType ? ConstrainResultType.shouldRun : ConstrainResultType.shouldSkip,
    stepConstrainsResult,
    artifactConstrainsResult,
  }
}
