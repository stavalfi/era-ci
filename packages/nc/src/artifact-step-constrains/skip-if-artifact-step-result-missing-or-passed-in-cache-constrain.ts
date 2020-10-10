import { createArtifactStepConstrain } from '../create-artifact-step-constrain'
import { ConstrainResult, ExecutionStatus, Status } from '../types'
import { didPassOrSkippedAsPassed } from '../utils'

export const skipIfArtifactStepResultMissingOrPassedInCacheConstrain = createArtifactStepConstrain<{
  stepNameToSearchInCache: string
  skipAsFailedIfStepNotFoundInCache: boolean
}>({
  constrainName: 'skip-if-artifact-step-result-missing-or-passed-in-cache-constrain',
  constrain: async ({ currentArtifact, cache, currentStepInfo, constrainConfigurations, steps, flowId }) => {
    const stepName = constrainConfigurations.stepNameToSearchInCache
    const step = steps.find(step => step.data.stepInfo.stepName === stepName)

    if (!step) {
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
      stepId: step.data.stepInfo.stepId,
      artifactHash: currentArtifact.data.artifact.packageHash,
    })

    if (!actualStepResult) {
      if (constrainConfigurations.skipAsFailedIfStepNotFoundInCache) {
        return {
          constrainResult: ConstrainResult.shouldSkip,
          artifactStepResult: {
            errors: [],
            notes: [`could not find step result of: "${step.data.stepInfo.displayName}"`],
            executionStatus: ExecutionStatus.aborted,
            status: Status.skippedAsFailed,
          },
        }
      } else {
        return {
          constrainResult: ConstrainResult.ignoreThisConstrain,
          artifactStepResult: {
            errors: [],
            notes: [],
          },
        }
      }
    }

    if (didPassOrSkippedAsPassed(actualStepResult.artifactStepResult.status)) {
      const isResultFromThisFlow = flowId === actualStepResult.flowId
      const isThisStep = currentStepInfo.data.stepInfo.stepId === step.data.stepInfo.stepId
      const notes: string[] = []
      if (isResultFromThisFlow && isThisStep) {
        throw new Error(
          `we can't be here because we can't pass on this step in this flow if this step didn't run it in this flow`,
        )
      }
      if (isResultFromThisFlow && !isThisStep) {
        notes.push(`step: "${step.data.stepInfo.displayName}" passed`)
      }
      if (!isResultFromThisFlow && isThisStep) {
        notes.push(`step already passed in flow: "${actualStepResult.flowId}"`)
      }
      if (!isResultFromThisFlow && !isThisStep) {
        notes.push(`step: "${step.data.stepInfo.displayName}" passed in flow: "${actualStepResult.flowId}"`)
      }
      return {
        constrainResult: ConstrainResult.shouldSkip,
        artifactStepResult: {
          errors: [],
          notes,
          executionStatus: ExecutionStatus.aborted,
          status: Status.skippedAsPassed,
        },
      }
    } else {
      return {
        constrainResult: ConstrainResult.ignoreThisConstrain,
        artifactStepResult: {
          errors: [],
          notes: [],
        },
      }
    }
  },
})
