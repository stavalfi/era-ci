import { Step, StepInfo } from './create-step'
import { Graph } from './types'

export function createLinearStepsGraph<TaskQueueName>(
  steps: Step<TaskQueueName>[],
): Graph<{ stepInfo: StepInfo; taskQueueName: TaskQueueName; runStep: Step<TaskQueueName>['runStep'] }> {
  return steps.map((step, i, array) => {
    const stepId = `${step.stepName}-${i}`
    const isExistsOnce = array.filter(s => s.stepName === step.stepName).length === 1
    return {
      index: i,
      data: {
        stepInfo: {
          stepName: step.stepName,
          stepId: `${step.stepName}-${i}`,
          displayName: isExistsOnce ? step.stepName : stepId,
        },
        taskQueueName: step.taskQueueName,
        runStep: step.runStep,
      },
      parentsIndexes: i === 0 ? [] : [i - 1],
      childrenIndexes: i === array.length - 1 ? [] : [i + 1],
    }
  })
}
