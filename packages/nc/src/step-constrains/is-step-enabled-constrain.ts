import { createStepConstrain } from '../create-step-constrain'
import { ExecutionStatus, Status } from '../types'

export const isStepEnabledConstrain = createStepConstrain<void, void, { isStepEnabled: boolean }>({
  constrainName: 'is-step-enabled-constrain',
  constrain: async ({ stepConfigurations, currentStepInfo }) => {
    if (stepConfigurations.isStepEnabled) {
      return true
    } else {
      return {
        canRun: false,
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
