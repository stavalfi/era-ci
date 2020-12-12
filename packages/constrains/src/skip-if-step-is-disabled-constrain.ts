import { ConstrainResultType, createConstrain } from '@tahini/core'
import { ExecutionStatus, Status } from '@tahini/utils'

export const skipIfStepIsDisabledConstrain = createConstrain<void, void, { isStepEnabled: boolean }>({
  constrainName: 'skip-if-step-is-disabled-constrain',
  constrain: async ({ stepConfigurations }) => {
    if (stepConfigurations.isStepEnabled) {
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
          status: Status.skippedAsPassed,
          notes: [`step is disabled`],
        },
      }
    }
  },
})