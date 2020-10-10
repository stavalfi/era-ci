import { createArtifactStepConstrain } from '../create-artifact-step-constrain'
import { ConstrainResult, ExecutionStatus, Status } from '../types'
import { didPassOrSkippedAsPassed } from '../utils'

export const skipIfArtifactStepResultMissingOrFailedInCacheConstrain = createArtifactStepConstrain({
  constrainName: 'skip-if-artifact-step-result-missing-or-failed-on-step-constrain',
  constrain: async ({ currentArtifact, cache, currentStepInfo }) => {
    const actualStepResult = await cache.step.getArtifactStepResult({
      stepId: currentStepInfo.data.stepInfo.stepId,
      artifactHash: currentArtifact.data.artifact.packageHash,
    })

    if (!actualStepResult || !didPassOrSkippedAsPassed(actualStepResult.artifactStepResult.status)) {
      return {
        constrainResult: ConstrainResult.shouldSkip,
        artifactStepResult: {
          errors: [],
          notes: [`artifact already failed on this step in flow: "${actualStepResult?.flowId}"`],
          executionStatus: ExecutionStatus.aborted,
          status: Status.skippedAsFailed,
        },
      }
    }

    return {
      constrainResult: ConstrainResult.ignoreThisConstrain,
      artifactStepResult: {
        errors: [],
        notes: [],
      },
    }
  },
})
