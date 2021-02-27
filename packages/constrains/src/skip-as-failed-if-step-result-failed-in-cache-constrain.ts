import { ConstrainResultType, createConstrain } from '@era-ci/core'
import { ExecutionStatus, Status } from '@era-ci/utils'

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
      const notes: string[] = []
      if (stepResult.failed.length > 0) {
        const plural = stepResult.failed.length > 1 ? 'flows' : 'flow'

        notes.push(
          `step: "${step.data.stepInfo.displayName}" failed in ${plural}: ${stepResult.failed
            .map(f => (f.flowId === flowId ? 'this-flow' : f.flowId))
            .join(',')}`,
        )
      } else {
        const plural = stepResult.passed.length > 1 ? 'flows' : 'flow'

        notes.push(
          `step: "${step.data.stepInfo.displayName}" failed in ${plural}: ${stepResult.skippedAsFailed
            .map(f => (f.flowId === flowId ? 'this-flow' : f.flowId))
            .join(',')}`,
        )
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
