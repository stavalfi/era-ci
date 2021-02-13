import { ConstrainResultType, createConstrain } from '@era-ci/core'
import { ExecutionStatus, Status } from '@era-ci/utils'

export const skipAsFailedIfStepResultMissingInCacheConstrain = createConstrain<{
  stepNameToSearchInCache: string
  skipAsPassedIfStepNotExists?: boolean
}>({
  constrainName: 'skip-as-failed-if-step-result-missing-in-cache-constrain',
  constrain: async ({
    immutableCache,
    currentStepInfo,
    steps,
    constrainConfigurations: { stepNameToSearchInCache, skipAsPassedIfStepNotExists = true },
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

    if (actualStepResult) {
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
          executionStatus: ExecutionStatus.aborted,
          status: Status.skippedAsFailed,
          errors: [],
          notes: [`step result of: "${stepName}" doesn't exists in cache`],
        },
      }
    }
  },
})
