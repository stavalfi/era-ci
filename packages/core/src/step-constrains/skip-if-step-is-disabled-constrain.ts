import { createStepConstrain } from '../create-step-constrain'
import { ConstrainResult, ExecutionStatus, Status } from '@tahini/utils'

export const skipIfStepIsDisabledConstrain = createStepConstrain<void, void, { isStepEnabled: boolean }>({
  constrainName: 'skip-if-step-is-disabled-constrain',
  constrain: async ({ stepConfigurations, currentStepInfo }) => {
    if (stepConfigurations.isStepEnabled) {
      return {
        constrainResult: ConstrainResult.ignoreThisConstrain,
        stepResult: {
          errors: [],
          notes: [],
        },
      }
    } else {
      return {
        constrainResult: ConstrainResult.shouldSkip,
        stepResult: {
          errors: [],
          executionStatus: ExecutionStatus.aborted,
          status: Status.skippedAsPassed,
          notes: [`step is disabled`],
        },
      }
    }
  },
})
