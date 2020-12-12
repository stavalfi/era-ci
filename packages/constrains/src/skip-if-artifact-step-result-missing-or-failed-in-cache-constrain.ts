import { ConstrainResultType, createConstrain } from '@tahini/core'
import { Artifact, didPassOrSkippedAsPassed, ExecutionStatus, Node, Status } from '@tahini/utils'

export const skipIfArtifactStepResultMissingOrFailedInCacheConstrain = createConstrain<{
  stepNameToSearchInCache: string
  skipAsFailedIfStepNotFoundInCache: boolean
  skipAsPassedIfStepNotExists: boolean
  currentArtifact: Node<{ artifact: Artifact }>
}>({
  constrainName: 'skip-if-artifact-step-result-missing-or-failed-in-cache-constrain',
  constrain: async ({
    immutableCache,
    currentStepInfo,
    steps,
    flowId,
    constrainConfigurations: {
      currentArtifact,
      stepNameToSearchInCache,
      skipAsPassedIfStepNotExists,
      skipAsFailedIfStepNotFoundInCache,
    },
  }) => {
    const stepName = stepNameToSearchInCache
    const step = steps.find(step => step.data.stepInfo.stepName === stepName)

    if (!step) {
      if (skipAsPassedIfStepNotExists) {
        return {
          constrainResultType: ConstrainResultType.ignoreThisConstrain,
          result: {
            errors: [],
            notes: [],
          },
        }
      } else {
        return {
          constrainResultType: ConstrainResultType.shouldSkip,
          result: {
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
      if (skipAsFailedIfStepNotFoundInCache) {
        return {
          constrainResultType: ConstrainResultType.shouldSkip,
          result: {
            errors: [],
            notes: [`could not find step result of: "${step.data.stepInfo.displayName}"`],
            executionStatus: ExecutionStatus.aborted,
            status: Status.skippedAsFailed,
          },
        }
      } else {
        return {
          constrainResultType: ConstrainResultType.ignoreThisConstrain,
          result: {
            errors: [],
            notes: [],
          },
        }
      }
    }

    if (didPassOrSkippedAsPassed(actualStepResult.artifactStepResult.status)) {
      return {
        constrainResultType: ConstrainResultType.ignoreThisConstrain,
        result: {
          errors: [],
          notes: [],
        },
      }
    } else {
      const isResultFromThisFlow = flowId === actualStepResult.flowId
      const isThisStep = currentStepInfo.data.stepInfo.stepId === step.data.stepInfo.stepId
      const notes: string[] = []
      if (isResultFromThisFlow && isThisStep) {
        // we are running the ci again and nothing was changed in the repo
        notes.push(`step already failed`)
      }
      if (isResultFromThisFlow && !isThisStep) {
        notes.push(`step: "${step.data.stepInfo.displayName}" failed`)
      }
      if (!isResultFromThisFlow && isThisStep) {
        notes.push(`step already failed in flow: "${actualStepResult.flowId}"`)
      }
      if (!isResultFromThisFlow && !isThisStep) {
        notes.push(`step: "${step.data.stepInfo.displayName}" failed in flow: "${actualStepResult.flowId}"`)
      }
      return {
        constrainResultType: ConstrainResultType.shouldSkip,
        result: {
          errors: [],
          notes,
          executionStatus: ExecutionStatus.aborted,
          status: Status.skippedAsFailed,
        },
      }
    }
  },
})
