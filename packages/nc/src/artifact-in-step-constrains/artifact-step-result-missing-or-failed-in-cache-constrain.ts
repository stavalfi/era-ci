import { createArtifactInStepConstrain } from '../create-artifact-in-step-constrain'
import { ExecutionStatus, Status } from '../types'

export const artifactStepResultMissingOrFailedInCacheConstrain = createArtifactInStepConstrain<{
  stepNameToSearchInCache: string
}>({
  constrainName: 'artifact-step-result-missing-or-failed-in-cache-constrain',
  constrain: async ({ constrainConfigurations, currentArtifact, cache, steps, currentStepInfo }) => {
    const stepName = constrainConfigurations.stepNameToSearchInCache
    const stepId = steps.find(step => step.data.stepInfo.stepName === stepName)?.data.stepInfo.stepId

    if (!stepId) {
      return {
        canRun: false,
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
        canRun: true,
        artifactStepResult: { errors: [], notes: [] },
      }
    }

    if ([Status.failed, Status.skippedAsFailed].includes(actualStepResult.artifactStepResult.status)) {
      return {
        canRun: true,
        artifactStepResult: { errors: [], notes: [] },
      }
    } else {
      return {
        canRun: false,
        artifactStepResult: {
          errors: [],
          notes: [
            `step: "${stepName}" passed on this artifact but step: "${currentStepInfo.data.stepInfo.displayName}" will run only on failure`,
          ],
          executionStatus: ExecutionStatus.aborted,
          status: Status.skippedAsFailed,
        },
      }
    }
  },
})
