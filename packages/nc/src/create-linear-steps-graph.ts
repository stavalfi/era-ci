import { Step, StepInfo } from './create-step'
import { ConfigureTaskQueue, TaskQueueBase } from './create-task-queue'
import { Graph } from './types'

export function createLinearStepsGraph<TaskQueue extends TaskQueueBase<string>>(
  steps: Array<Step<string, TaskQueue>>,
): Graph<{
  stepInfo: StepInfo
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  configureTaskQueue: ConfigureTaskQueue<string, TaskQueue, any>
  runStep: Step<string, TaskQueue>['runStep']
}> {
  // @ts-ignore
  return steps
}

export function createLinearStepsGraph1<TaskQueueName extends string, TaskQueue extends TaskQueueBase<TaskQueueName>>(
  steps: Array<Step<TaskQueueName, TaskQueue>>,
): Graph<{
  stepInfo: StepInfo
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  configureTaskQueue: ConfigureTaskQueue<TaskQueueName, TaskQueue, any>
  runStep: Step<TaskQueueName, TaskQueue>['runStep']
}> {
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
        configureTaskQueue: step.configureTaskQueue,
        runStep: step.runStep,
      },
      parentsIndexes: i === 0 ? [] : [i - 1],
      childrenIndexes: i === array.length - 1 ? [] : [i + 1],
    }
  })
}
