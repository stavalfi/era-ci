import _ from 'lodash'
import { ErrorObject, serializeError } from 'serialize-error'
import { UserRunStepOptions } from '../create-step'
import { Artifact, ConstrainResult, ExecutionStatus, Node, Status, calculateCombinedStatus } from '@tahini/utils'
import { ArtifactInStepConstrain, ArtifactInStepConstrainResult, CombinedArtifactInStepConstrainResult } from './types'

export async function runCanRunStepOnArtifactPredicates<StepConfiguration>({
  predicates,
  userRunStepOptions,
  currentArtifact,
}: {
  userRunStepOptions: Omit<UserRunStepOptions<never, StepConfiguration>, 'taskQueue'>
  currentArtifact: Node<{ artifact: Artifact }>
  predicates: Array<ArtifactInStepConstrain<StepConfiguration>>
}): Promise<CombinedArtifactInStepConstrainResult> {
  const results = await Promise.all(
    predicates.map(async p => {
      const { invoke, constrainOptions } = await p.callConstrain({ userRunStepOptions, currentArtifact })
      return invoke().catch<ArtifactInStepConstrainResult>(error => ({
        constrainName: p.constrainName,
        constrainResult: ConstrainResult.shouldSkip,
        artifactStepResult: {
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
    [ConstrainResult.shouldRun, ConstrainResult.ignoreThisConstrain].includes(x.constrainResult),
  )
  const notes = _.uniq(_.flatMapDeep(results.map(r => r.artifactStepResult.notes)))
  const errors = _.flatMapDeep<ErrorObject>(results.map(r => r.artifactStepResult.errors))
  if (canRun) {
    return {
      constrainResult: ConstrainResult.shouldRun,
      artifactStepResult: {
        notes,
        errors,
      },
      constrainsResult: results,
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
      constrainsResult: results,
    }
  }
}
