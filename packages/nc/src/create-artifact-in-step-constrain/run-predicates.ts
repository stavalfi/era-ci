import _ from 'lodash'
import { ErrorObject, serializeError } from 'serialize-error'
import { UserRunStepOptions } from '../create-step'
import { Artifact, ConstrainResult, ExecutionStatus, Node, Status } from '../types'
import { calculateCombinedStatus } from '../utils'
import { ArtifactInStepConstrain, ArtifactInStepConstrainResult, CombinedArtifactInStepConstrainResult } from './types'

export async function runCanRunStepOnArtifactPredicates<StepConfiguration>({
  predicates,
  userRunStepOptions,
  currentArtifact,
}: {
  userRunStepOptions: UserRunStepOptions<StepConfiguration>
  currentArtifact: Node<{ artifact: Artifact }>
  predicates: Array<ArtifactInStepConstrain<StepConfiguration>>
}): Promise<CombinedArtifactInStepConstrainResult> {
  const results = await Promise.all(
    predicates.map(x =>
      x.callConstrain({ userRunStepOptions, currentArtifact }).catch<ArtifactInStepConstrainResult>(error => ({
        constrainResult: ConstrainResult.shouldSkip,
        artifactStepResult: {
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
  const notes = _.uniq(_.flatMapDeep(results.map(x => x.artifactStepResult.notes)))
  const errors = _.flatMapDeep<ErrorObject>(results.map(x => x.artifactStepResult.errors ?? []))
  if (canRun) {
    return {
      constrainResult: ConstrainResult.shouldRun,
      artifactStepResult: {
        notes,
        errors,
      },
    }
  } else {
    const artifactStepResultStatus = calculateCombinedStatus(
      _.flatMapDeep(
        results.map(r => (r.constrainResult === ConstrainResult.shouldSkip ? [r.artifactStepResult.status] : [])),
      ),
    )
    return {
      constrainResult: ConstrainResult.shouldSkip,
      artifactStepResult: {
        notes,
        executionStatus: ExecutionStatus.aborted,
        status: artifactStepResultStatus,
        errors,
      },
    }
  }
}
