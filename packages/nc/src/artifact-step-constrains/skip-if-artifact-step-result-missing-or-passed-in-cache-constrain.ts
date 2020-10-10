import { createArtifactStepConstrain } from '../create-artifact-step-constrain'
import { ConstrainResult, ExecutionStatus, Status } from '../types'
import { didPassOrSkippedAsPassed } from '../utils'

export const skipIfArtifactStepResultMissingOrPassedInCacheConstrain = createArtifactStepConstrain<{
  stepNameToSearchInCache: string
}>({
  constrainName: 'skip-if-artifact-step-result-missing-or-passed-in-cache-constrain',
  constrain: async ({ currentArtifact, cache, currentStepInfo, constrainConfigurations, steps }) => {
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

    if (!actualStepResult || didPassOrSkippedAsPassed(actualStepResult.artifactStepResult.status)) {
      return {
        constrainResult: ConstrainResult.shouldSkip,
        artifactStepResult: {
          errors: [],
          notes: [`artifact already passed on this step in flow: "${actualStepResult?.flowId}"`],
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
