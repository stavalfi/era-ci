import { createArtifactInStepConstrain } from '../create-artifact-in-step-constrain'
import { ConstrainResult, ExecutionStatus, Status } from '../types'

export const artifactStepResultMissingOrPassedInCacheConstrain = createArtifactInStepConstrain<{
  stepNameToSearchInCache: string
}>({
  constrainName: 'step-missing-or-passed-in-cache-constrain',
  constrain: async ({ constrainConfigurations, currentArtifact, cache, steps, currentStepInfo }) => {
    const stepName = constrainConfigurations.stepNameToSearchInCache
    const stepId = steps.find(step => step.data.stepInfo.stepName === stepName)?.data.stepInfo.stepId

    if (!stepId) {
      return {
        constrainResult: ConstrainResult.shouldSkip,
        artifactStepResult: {
          errors: [],
          executionStatus: ExecutionStatus.aborted,
          status: Status.skippedAsFailed,
          // if the constrain needs this missing step, then it means that the step that is using
          // this constrain needs this missing step to run. and if it is missing, the result are missing
          // as well so it means that we should skip the run of the current step.
          notes: [
            `step: "${stepName}" doesn't exists in this flow and is required step: "${currentStepInfo.data.stepInfo.displayName}"`,
          ],
        },
      }
    }

    const actualStepResult = await cache.step.getArtifactStepResult({
      stepId,
      artifactHash: currentArtifact.data.artifact.packageHash,
    })

    if (!actualStepResult) {
      return {
        constrainResult: ConstrainResult.shouldRun,
        artifactStepResult: { errors: [], notes: [] },
      }
    }

    if ([Status.passed, Status.skippedAsPassed].includes(actualStepResult.artifactStepResult.status)) {
      return {
        constrainResult: ConstrainResult.shouldRun,
        artifactStepResult: { errors: [], notes: [] },
      }
    } else {
      return {
        constrainResult: ConstrainResult.shouldSkip,
        artifactStepResult: {
          errors: [],
          notes: [
            `step: "${stepName}" failed on this artifact but step: "${currentStepInfo.data.stepInfo.displayName}" will run only on succeess`,
          ],
          executionStatus: ExecutionStatus.aborted,
          status: Status.skippedAsFailed,
        },
      }
    }
  },
})
