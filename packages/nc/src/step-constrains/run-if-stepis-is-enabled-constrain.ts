import { createStepConstrain } from '../create-step-constrain'
import { ConstrainResult, ExecutionStatus, Status } from '../types'

export const runIfStepIsEnabledConstrain = createStepConstrain<void, void, { isStepEnabled: boolean }>({
  constrainName: 'run-if-stepis-is-enabled-constrain',
  constrain: async ({ stepConfigurations, currentStepInfo }) => {
    if (stepConfigurations.isStepEnabled) {
      return {
        constrainResult: ConstrainResult.shouldRun,
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
          notes: [`step: "${currentStepInfo.data.stepInfo.displayName}" is disabled`],
        },
      }
    }
  },
})
