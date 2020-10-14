import { createStepConstrain } from '../create-step-constrain'
import { ConstrainResult, ExecutionStatus, Status } from '../types'
import { didPassOrSkippedAsPassed } from '../utils'

export const skipIfStepResultNotPassedConstrain = createStepConstrain<{
  stepName: string
}>({
  constrainName: 'skip-if-step-result-not-passed-constrain',
  constrain: async ({ constrainConfigurations, steps, stepsResultOfArtifactsByStep }) => {
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
          notes: [`step: "${stepName}" doesn't exists in this flow`],
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
        constrainResult: ConstrainResult.ignoreThisConstrain,
        stepResult: { errors: [], notes: [] },
      }
    } else {
      let reason: string
      switch (actualStepResult.executionStatus) {
        case ExecutionStatus.done:
        case ExecutionStatus.aborted:
          reason = `didn't pass`
          break
        case ExecutionStatus.running:
          reason = `is still running but required to succeed`
          break
        case ExecutionStatus.scheduled:
          reason = `didn't start yet but required to succeed`
          break
      }
      return {
        constrainResult: ConstrainResult.shouldSkip,
        stepResult: {
          errors: [],
          notes: [`step: "${step.data.stepInfo.displayName}" ${reason}`],
          executionStatus: ExecutionStatus.aborted,
          status: Status.skippedAsFailed,
        },
      }
    }
  },
})
