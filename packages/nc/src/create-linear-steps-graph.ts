import { Step, StepInfo } from './create-step'
import { Graph } from './types'

export function createLinearStepsGraph(steps: Step[]): Graph<{ stepInfo: StepInfo; runStep: Step['runStep'] }> {
  return steps.map((step, i, array) => ({
    index: i,
    data: {
      stepInfo: {
        stepName: step.stepName,
        stepId: `${step.stepName}-${i}`,
      },
      runStep: step.runStep,
    },
    parentsIndexes: i === 0 ? [] : [i - 1],
    childrenIndexes: i === array.length - 1 ? [] : [i + 1],
  }))
}
