import { createArtifactStepConstrain } from '@tahini/core'
import { didPassOrSkippedAsPassed, ConstrainResult, ExecutionStatus, Status } from '@tahini/utils'

export const skipIfArtifactStepResultMissingOrPassedInCacheConstrain = createArtifactStepConstrain<{
  stepNameToSearchInCache: string
  skipAsFailedIfStepNotFoundInCache: boolean
  skipAsPassedIfStepNotExists: boolean
}>({
  constrainName: 'skip-if-artifact-step-result-missing-or-passed-in-cache-constrain',
  constrain: async ({ currentArtifact, immutableCache, currentStepInfo, constrainConfigurations, steps, flowId }) => {
    const stepName = constrainConfigurations.stepNameToSearchInCache
    const step = steps.find(step => step.data.stepInfo.stepName === stepName)

    if (!step) {
      if (constrainConfigurations.skipAsPassedIfStepNotExists) {
        return {
          constrainResult: ConstrainResult.ignoreThisConstrain,
          artifactStepResult: {
            errors: [],
            notes: [],
          },
        }
      } else {
        return {
          constrainResult: ConstrainResult.shouldSkip,
          artifactStepResult: {
            errors: [],
            executionStatus: ExecutionStatus.aborted,
            status: Status.skippedAsFailed,
            notes: [
              `step: "${stepName}" doesn't exists in this flow and is required step: "${currentStepInfo.data.stepInfo.displayName}"`,
            ],
          },
        }
      }
    }

    const actualStepResult = await immutableCache.step.getArtifactStepResult({
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
        // we are running the ci again and nothing was changed in the repo
        notes.push(`step already passed`)
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
