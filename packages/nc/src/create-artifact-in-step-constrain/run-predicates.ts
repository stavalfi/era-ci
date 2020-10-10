import _ from 'lodash'
import { ErrorObject, serializeError } from 'serialize-error'
import { UserRunStepOptions } from '../create-step'
import { Artifact, ExecutionStatus, Node, Status } from '../types'
import { calculateCombinedStatus } from '../utils'
import { ArtifactInStepConstrainResult, ArtifactInStepConstrain } from './types'

export async function runCanRunStepOnArtifactPredicates<StepConfiguration>({
  predicates,
  userRunStepOptions,
  currentArtifact,
}: {
  userRunStepOptions: UserRunStepOptions<StepConfiguration>
  currentArtifact: Node<{ artifact: Artifact }>
  predicates: Array<ArtifactInStepConstrain<StepConfiguration>>
}): Promise<ArtifactInStepConstrainResult> {
  const results = await Promise.all(
    predicates.map(x =>
      x.callConstrain({ userRunStepOptions, currentArtifact }).catch<ArtifactInStepConstrainResult>(error => ({
        canRun: false,
        artifactStepResult: {
          executionStatus: ExecutionStatus.aborted,
          status: Status.skippedAsFailed,
          notes: [],
          errors: [serializeError(error)],
        },
      })),
    ),
  )
  const canRun = results.every(x => x === true || x.canRun)
  const notes = _.uniq(_.flatMapDeep(results.map(x => (x === true ? [] : x.artifactStepResult.notes))))
  const errors = _.flatMapDeep<ErrorObject>(results.map(x => (x === true ? [] : x.artifactStepResult.errors ?? [])))
  if (canRun) {
    return {
      canRun: true,
      artifactStepResult: {
        notes,
        errors,
      },
    }
  } else {
    const artifactStepResultStatus = calculateCombinedStatus(
      _.flatMapDeep(results.map(r => (r === true || r.canRun ? [] : [r.artifactStepResult.status]))),
    )
    return {
      canRun: false,
      artifactStepResult: {
        notes,
        executionStatus: ExecutionStatus.aborted,
        status: artifactStepResultStatus,
        errors,
      },
    }
  }
}
