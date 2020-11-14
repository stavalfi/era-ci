import _ from 'lodash'
import { ErrorObject, serializeError } from 'serialize-error'
import { UserRunStepOptions } from '../create-step'
import { ConstrainResult, ExecutionStatus, Status } from '../types'
import { calculateCombinedStatus } from '../utils'
import { CombinedStepConstrainResult, StepConstrain, StepConstrainResult } from './types'

export async function runConstrains<StepConfiguration>({
  predicates,
  userRunStepOptions,
}: {
  userRunStepOptions: Omit<UserRunStepOptions<never, never, StepConfiguration>, 'taskQueue'>
  predicates: Array<StepConstrain<StepConfiguration>>
}): Promise<CombinedStepConstrainResult> {
  const results = await Promise.all(
    predicates.map(p =>
      p.callConstrain({ userRunStepOptions }).catch<StepConstrainResult>(error => ({
        constrainResult: ConstrainResult.shouldSkip,
        stepResult: {
          executionStatus: ExecutionStatus.aborted,
          status: Status.skippedAsFailed,
          notes: [],
          errors: [serializeError(error)],
        },
      })),
    ),
  )
  const canRun = results.every(x =>
    [ConstrainResult.shouldRun, ConstrainResult.ignoreThisConstrain].includes(x.constrainResult),
  )
  const notes = _.uniq(_.flatMapDeep(results.map(x => x.stepResult.notes)))
  const errors = _.flatMapDeep<ErrorObject>(results.map(x => x.stepResult.errors ?? []))
  if (canRun) {
    return {
      constrainResult: ConstrainResult.shouldRun,
      stepResult: {
        notes,
        errors,
      },
    }
  } else {
    const artifactStepResultStatus = calculateCombinedStatus(
      _.flatMapDeep(results.map(r => (r.constrainResult === ConstrainResult.shouldSkip ? [r.stepResult.status] : []))),
    )
    return {
      constrainResult: ConstrainResult.shouldSkip,
      stepResult: {
        notes,
        executionStatus: ExecutionStatus.aborted,
        status: artifactStepResultStatus,
        errors,
      },
    }
  }
}
