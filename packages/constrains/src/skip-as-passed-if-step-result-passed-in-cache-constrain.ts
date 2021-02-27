import { ConstrainResultType, createConstrain } from '@era-ci/core'
import { ExecutionStatus, Status } from '@era-ci/utils'
import { createFlowsPassedFailedNote } from './utils'

export const skipAsPassedIfStepResultPassedInCacheConstrain = createConstrain<{
  stepNameToSearchInCache: string
  skipAsPassedIfStepNotExists?: boolean
}>({
  constrainName: 'skip-as-passed-if-step-result-passed-in-cache-constrain',
  constrain: async ({
    immutableCache,
    currentStepInfo,
    steps,
    flowId,
    constrainConfigurations: { skipAsPassedIfStepNotExists = true, stepNameToSearchInCache },
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

    if (stepResult.passed.length > 0 || stepResult.skippedAsPassed.length > 0) {
      return {
        resultType: ConstrainResultType.shouldSkip,
        result: {
          errors: [],
          notes: [
            createFlowsPassedFailedNote({
              currentFlowId: flowId,
              flowIds:
                stepResult.passed.length > 0
                  ? stepResult.passed.map(r => r.flowId)
                  : stepResult.skippedAsPassed.map(r => r.flowId),
              result: 'passed',
              step: step.data.stepInfo.displayName,
            }),
          ],
          executionStatus: ExecutionStatus.aborted,
          status: Status.skippedAsPassed,
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
