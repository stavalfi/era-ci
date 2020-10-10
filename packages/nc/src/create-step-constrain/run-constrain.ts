import _ from 'lodash'
import { ErrorObject, serializeError } from 'serialize-error'
import { UserRunStepOptions } from '../create-step'
import { ExecutionStatus, Status } from '../types'
import { calculateCombinedStatus } from '../utils'
import { StepConstrainResult, StepConstrain } from './types'

export async function runSkipSteps<StepConfiguration>({
  predicates,
  userRunStepOptions,
}: {
  userRunStepOptions: UserRunStepOptions<StepConfiguration>
  predicates: Array<StepConstrain<StepConfiguration>>
}): Promise<StepConstrainResult> {
  const results = await Promise.all(
    predicates.map(x =>
      x.callConstrain({ userRunStepOptions }).catch<StepConstrainResult>(error => ({
        canRun: false,
        stepResult: {
          executionStatus: ExecutionStatus.aborted,
          status: Status.skippedAsFailed,
          notes: [],
          errors: [serializeError(error)],
        },
      })),
    ),
  )
  const canRun = results.every(x => x === true || x.canRun)
  const notes = _.uniq(_.flatMapDeep(results.map(x => (x === true ? [] : x.stepResult.notes))))
  const errors = _.flatMapDeep<ErrorObject>(results.map(x => (x === true ? [] : x.stepResult.errors ?? [])))
  if (canRun) {
    return {
      canRun: true,
      stepResult: {
        notes,
        errors,
      },
    }
  } else {
    const artifactStepResultStatus = calculateCombinedStatus(
      _.flatMapDeep(results.map(r => (r === true || r.canRun ? [] : [r.stepResult.status]))),
    )
    return {
      canRun: false,
      stepResult: {
        notes,
        executionStatus: ExecutionStatus.aborted,
        status: artifactStepResultStatus,
        errors,
      },
    }
  }
}
