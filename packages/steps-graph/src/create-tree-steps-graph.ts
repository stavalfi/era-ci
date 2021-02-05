import { Step } from '@era-ci/core'
import { Steps } from './types'

export function createTreeStepsGraph<TaskQueueConfigurations, TaskPayload>(
  steps: Array<{ step: Step<any>; children: number[] }>,
): Steps<TaskQueueConfigurations, TaskPayload> {
  return steps.map(({ step, children }, i, array) => {
    const stepId = `${step.stepName}-${i}`
    const isExistsOnce = array.filter(s => s.step.stepName === step.stepName).length === 1
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
      parentsIndexes: array
        .map((step, index) => ({ step, index }))
        .filter(({ step }) => step.children.includes(i))
        .map(({ index }) => index),
      childrenIndexes: children,
    }
  })
}
