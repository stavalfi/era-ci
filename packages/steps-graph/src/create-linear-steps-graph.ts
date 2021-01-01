import { StepExperimental } from '@era-ci/core'
import { Steps } from './types'

export function createLinearStepsGraph<TaskQueueConfigurations>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  steps: Array<StepExperimental<any>>,
): Steps<TaskQueueConfigurations> {
  return steps.map((step, i, array) => {
    const stepId = `${step.stepName}-${i}`
    const isExistsOnce = array.filter(s => s.stepName === step.stepName).length === 1
    return {
      index: i,
      data: {
        stepInfo: {
          stepGroup: step.stepGroup,
          stepName: step.stepName,
          stepId: `${step.stepName}-${i}`,
          displayName: isExistsOnce ? step.stepName : stepId,
        },
        taskQueueClass: step.taskQueueClass,
        runStep: step.runStep,
      },
      parentsIndexes: i === 0 ? [] : [i - 1],
      childrenIndexes: i === array.length - 1 ? [] : [i + 1],
    }
  })
}
