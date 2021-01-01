import { ConstrainResultType, createConstrain } from '@era-ci/core'
import { ExecutionStatus, Status } from '@era-ci/utils'

export const skipIfStepIsDisabledConstrain = createConstrain<void, void, { isStepEnabled: boolean }>({
  constrainName: 'skip-if-step-is-disabled-constrain',
  constrain: async ({ stepConfigurations }) => {
    if (stepConfigurations.isStepEnabled) {
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
          status: Status.skippedAsPassed,
          notes: [`step is disabled`],
        },
      }
    }
  },
})
