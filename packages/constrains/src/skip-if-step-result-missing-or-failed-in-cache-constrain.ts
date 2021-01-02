import { ConstrainResultType, createConstrain } from '@era-ci/core'
import { didPassOrSkippedAsPassed, ExecutionStatus, Status } from '@era-ci/utils'

export const skipIfStepResultMissingOrFailedInCacheConstrain = createConstrain<{
  stepNameToSearchInCache: string
  skipAsFailedIfStepResultNotFoundInCache: boolean
  skipAsPassedIfStepNotExists?: boolean
}>({
  constrainName: 'skip-if-step-result-missing-or-failed-in-cache-constrain',
  constrain: async ({
    immutableCache,
    currentStepInfo,
    steps,
    flowId,
    constrainConfigurations: {
      stepNameToSearchInCache,
      skipAsPassedIfStepNotExists = true,
      skipAsFailedIfStepResultNotFoundInCache,
    },
  }) => {
    const stepName = stepNameToSearchInCache
    const step = steps.find(step => step.data.stepInfo.stepName === stepName)

    if (!step) {
      if (skipAsPassedIfStepNotExists) {
        return {
          resultType: ConstrainResultType.ignoreThisConstrain,
          result: {
            errors: [],
            notes: [],
          },
        }
      } else {
        return {
          resultType: ConstrainResultType.shouldSkip,
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

    const actualStepResult = await immutableCache.step.getStepResult({
      stepId: step.data.stepInfo.stepId,
    })

    if (!actualStepResult) {
      if (skipAsFailedIfStepResultNotFoundInCache) {
        return {
          resultType: ConstrainResultType.shouldSkip,
          result: {
            errors: [],
            notes: [`could not find step result of: "${step.data.stepInfo.displayName}"`],
            executionStatus: ExecutionStatus.aborted,
            status: Status.skippedAsFailed,
          },
        }
      } else {
        return {
          resultType: ConstrainResultType.ignoreThisConstrain,
          result: {
            errors: [],
            notes: [],
          },
        }
      }
    }

    if (didPassOrSkippedAsPassed(actualStepResult.stepResult.status)) {
      return {
        resultType: ConstrainResultType.ignoreThisConstrain,
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
        resultType: ConstrainResultType.shouldSkip,
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
