import { StepExperimental } from '@era-ci/core'
import { Steps } from './types'

export function createLinearStepsGraph<TaskQueueConfigurations, TaskPayload>(
  steps: Array<StepExperimental<any>>,
): Steps<TaskQueueConfigurations, TaskPayload> {
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
