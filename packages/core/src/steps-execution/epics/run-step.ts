import { ExecutionStatus, Graph, StepInfo, StepOutputEventType } from '@era-ci/utils'
import { Epic } from 'redux-observable'
import { filter } from 'rxjs/operators'
import { RunStepOptions, StepExperimental } from '../../create-step'
import { TaskQueueBase, TaskQueueOptions } from '../../create-task-queue'
import { Actions } from '../actions'
import { State } from '../state'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createStepEpic<TaskQueue extends TaskQueueBase<any, any>>(
  options: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    taskQueues: Array<TaskQueueBase<any, any>>
    stepsToRun: Graph<{
      stepInfo: StepInfo
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      taskQueueClass: { new (options: TaskQueueOptions<any>): any }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      runStep: StepExperimental<any>['runStep']
    }>
  } & Omit<RunStepOptions<TaskQueue>, 'taskQueue'>,
): Epic<Actions, Actions, State> {
  const taskQueue = options.taskQueues.find(
    t => t instanceof options.stepsToRun[options.currentStepInfo.index].data.taskQueueClass,
  )
  if (!taskQueue) {
    throw new Error(
      `can't find task-queue: "${
        options.stepsToRun[options.currentStepInfo.index].data.taskQueueClass.name
      }" for step: "${
        options.stepsToRun[options.currentStepInfo.index].data.stepInfo.displayName
      }" needs. did you forgot to declare the task-queue in the configuration file?`,
    )
  }
  function isRecursiveParent(stepIndex: number, possibleParentIndex: number): boolean {
    return (
      options.steps[stepIndex].parentsIndexes.includes(possibleParentIndex) ||
      options.steps[stepIndex].parentsIndexes.some(p => isRecursiveParent(p, possibleParentIndex))
    )
  }

  return action$ =>
    options.stepsToRun[options.currentStepInfo.index].data.runStep(
      { ...options, taskQueue, currentStepInfo: options.steps[options.currentStepInfo.index] },
      action$.pipe(
        filter(
          action =>
            // only allow events from recuresive-parent-steps or scheduled-events from current step.
            isRecursiveParent(options.currentStepInfo.index, action.payload.step.index) ||
            (action.payload.step.index === options.currentStepInfo.index &&
              (action.payload.type === StepOutputEventType.step
                ? action.payload.stepResult.executionStatus === ExecutionStatus.scheduled
                : action.payload.artifactStepResult.executionStatus === ExecutionStatus.scheduled)),
        ),
      ),
    )
}
