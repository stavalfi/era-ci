import { Step, StepInfo } from './create-step'
import { TaskQueueBase, TaskQueueOptions } from './create-task-queue'
import { Graph } from './types'

export function createLinearStepsGraph<TaskQueueName extends string, TaskQueueConfigurations>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  steps: Array<Step<TaskQueueName, TaskQueueConfigurations, any>>,
): Graph<{
  stepInfo: StepInfo
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  taskQueueClass: { new (options: TaskQueueOptions<TaskQueueConfigurations>): any }
  runStep: Step<
    TaskQueueName,
    TaskQueueConfigurations,
    TaskQueueBase<TaskQueueName, TaskQueueConfigurations>
  >['runStep']
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
        taskQueueClass: step.taskQueueClass,
        runStep: step.runStep,
      },
      parentsIndexes: i === 0 ? [] : [i - 1],
      childrenIndexes: i === array.length - 1 ? [] : [i + 1],
    }
  })
}
