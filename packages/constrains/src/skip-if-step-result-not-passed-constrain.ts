import { ConstrainResultType, createConstrain } from '@tahini/core'
import { ExecutionStatus, Status, didPassOrSkippedAsPassed } from '@tahini/utils'

export const skipIfStepResultNotPassedConstrain = createConstrain<{
  stepName: string
}>({
  constrainName: 'skip-if-step-result-not-passed-constrain',
  constrain: async ({ constrainConfigurations, steps, stepsResultOfArtifactsByStep }) => {
    const stepName = constrainConfigurations.stepName
    const step = steps.find(step => step.data.stepInfo.stepName === stepName)

    if (!step) {
      return {
        constrainResultType: ConstrainResultType.shouldSkip,
        result: {
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
        constrainResultType: ConstrainResultType.ignoreThisConstrain,
        result: { errors: [], notes: [] },
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
        constrainResultType: ConstrainResultType.shouldSkip,
        result: {
          errors: [],
          notes: [`step: "${step.data.stepInfo.displayName}" ${reason}`],
          executionStatus: ExecutionStatus.aborted,
          status: Status.skippedAsFailed,
        },
      }
    }
  },
})
