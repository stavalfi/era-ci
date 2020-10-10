import { createArtifactInStepConstrain } from '../create-artifact-in-step-constrain'
import { ConstrainResult, ExecutionStatus, Status } from '../types'
import { didPassOrSkippedAsPassed } from '../utils'

export const rerunArtifactOnStepFailureConstrain = createArtifactInStepConstrain({
  constrainName: 'rerun-artifact-on-step-failure-constrain',
  constrain: async ({ currentArtifact, cache, currentStepInfo }) => {
    const actualStepResult = await cache.step.getArtifactStepResult({
      stepId: currentStepInfo.data.stepInfo.stepId,
      artifactHash: currentArtifact.data.artifact.packageHash,
    })

    if (!actualStepResult || !didPassOrSkippedAsPassed(actualStepResult.artifactStepResult.status)) {
      return {
        constrainResult: ConstrainResult.shouldRun,
        artifactStepResult: { errors: [], notes: [] },
      }
    }

    return {
      constrainResult: ConstrainResult.shouldSkip,
      artifactStepResult: {
        errors: [],
        notes: [`step already run and passed on this package in flow-id: "${actualStepResult.flowId}"`],
        executionStatus: ExecutionStatus.aborted,
        status: Status.skippedAsPassed,
      },
    }
  },
})
