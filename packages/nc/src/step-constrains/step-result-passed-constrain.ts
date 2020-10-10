import { createStepConstrain } from '../create-step-constrain'
import { ConstrainResult, ExecutionStatus, Status } from '../types'
import { didPassOrSkippedAsPassed } from '../utils'

export const stepResultPassedConstrain = createStepConstrain<{
  stepName: string
}>({
  constrainName: 'step-result-passed-constrain',
  constrain: async ({ constrainConfigurations, cache, steps, currentStepInfo, stepsResultOfArtifactsByStep }) => {
    const stepName = constrainConfigurations.stepName
    const step = steps.find(step => step.data.stepInfo.stepName === stepName)

    if (!step) {
      return {
        constrainResult: ConstrainResult.shouldSkip,
        stepResult: {
          errors: [],
          executionStatus: ExecutionStatus.aborted,
          status: Status.skippedAsFailed,
          // if the constrain needs this missing step, then it means that the step that is using
          // this constrain needs this missing step to run. and if it is missing, the result are missing
          // as well so it means that we should skip the run of the current step.
          notes: [
            `step: "${stepName}" doesn't exists in this flow and is required step: "${currentStepInfo.data.stepInfo.displayName}"`,
          ],
        },
      }
    }

    const actualStepResult = stepsResultOfArtifactsByStep[step.index].data.stepResult

    if (
      (actualStepResult.executionStatus === ExecutionStatus.done ||
        actualStepResult.executionStatus === ExecutionStatus.aborted) &&
      didPassOrSkippedAsPassed(actualStepResult.status)
    ) {
      return {
        constrainResult: ConstrainResult.shouldRun,
        stepResult: { errors: [], notes: [] },
      }
    } else {
      const didFail =
        (actualStepResult.executionStatus === ExecutionStatus.done ||
          actualStepResult.executionStatus === ExecutionStatus.aborted) &&
        [Status.failed, Status.skippedAsFailed].includes(actualStepResult.status)

      return {
        constrainResult: ConstrainResult.shouldSkip,
        stepResult: {
          errors: [],
          notes: [
            didFail
              ? `step: "${stepName}" failed but step: "${currentStepInfo.data.stepInfo.displayName}" will run only on succeess`
              : `step: "${stepName}" execution-status is: "${actualStepResult.executionStatus}" but step: "${currentStepInfo.data.stepInfo.displayName}" will run only on succeess`,
          ],
          executionStatus: ExecutionStatus.aborted,
          status: Status.skippedAsFailed,
        },
      }
    }
  },
})
