import { ConstrainResultType, createConstrain } from '@era-ci/core'
import { ExecutionStatus, Status, didPassOrSkippedAsPassed } from '@era-ci/utils'

export const skipIfStepResultPassedConstrain = createConstrain<{
  stepName: string
  skipAsPassedIfStepNotExists?: boolean
}>({
  constrainName: 'skip-if-step-result-passed-constrain',
  constrain: async ({ constrainConfigurations, steps, getState }) => {
    const stepName = constrainConfigurations.stepName
    const step = steps.find(step => step.data.stepInfo.stepName === stepName)

    if (!step) {
      if (constrainConfigurations.skipAsPassedIfStepNotExists) {
        return {
          resultType: ConstrainResultType.ignoreThisConstrain,
          result: { errors: [], notes: [] },
        }
      } else {
        return {
          resultType: ConstrainResultType.shouldSkip,
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
    }

    const actualStepResult = getState().stepsResultOfArtifactsByStep[step.index].data.stepResult

    if (
      (actualStepResult.executionStatus === ExecutionStatus.done ||
        actualStepResult.executionStatus === ExecutionStatus.aborted) &&
      didPassOrSkippedAsPassed(actualStepResult.status)
    ) {
      return {
        resultType: ConstrainResultType.shouldSkip,
        result: { executionStatus: ExecutionStatus.aborted, status: Status.skippedAsPassed, errors: [], notes: [] },
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
