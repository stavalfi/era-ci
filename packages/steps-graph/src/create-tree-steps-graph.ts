import { StepExperimental } from '@era-ci/core'
import { Steps } from './types'

export function createTreeStepsGraph<TaskQueueConfigurations>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  steps: Array<{ step: StepExperimental<any>; children: number[] }>,
): Steps<TaskQueueConfigurations> {
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
      parentsIndexes: array.filter(s => s.children.includes(i)).map((_, parentIndex) => parentIndex),
      childrenIndexes: children,
    }
  })
}
