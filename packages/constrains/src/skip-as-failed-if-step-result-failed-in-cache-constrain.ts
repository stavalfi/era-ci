import { ConstrainResultType, createConstrain } from '@era-ci/core'
import { ExecutionStatus, Status } from '@era-ci/utils'
import { createFlowsPassedFailedNote } from './utils'

export const skipAsFailedIfStepResultFailedInCacheConstrain = createConstrain<{
  stepNameToSearchInCache: string
  skipAsPassedIfStepNotExists?: boolean
}>({
  constrainName: 'skip-as-failed-if-step-result-failed-in-cache-constrain',
  constrain: async ({
    immutableCache,
    currentStepInfo,
    steps,
    flowId,
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

    const stepResult = await immutableCache.step.getStepResults({
      stepId: step.data.stepInfo.stepId,
    })

    if (stepResult.all.length === 0) {
      return {
        resultType: ConstrainResultType.ignoreThisConstrain,
        result: {
          errors: [],
          notes: [`artifact-step-result of: "${stepName}" doesn't exists in cache`],
        },
      }
    }

    if (stepResult.failed.length > 0 || stepResult.skippedAsFailed.length > 0) {
      return {
        resultType: ConstrainResultType.shouldSkip,
        result: {
          errors: [],
          notes: [
            createFlowsPassedFailedNote({
              currentFlowId: flowId,
              flowIds:
                stepResult.failed.length > 0
                  ? stepResult.failed.map(r => r.flowId)
                  : stepResult.skippedAsFailed.map(r => r.flowId),
              result: 'failed',
              step: step.data.stepInfo.displayName,
            }),
          ],
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
  },
})
