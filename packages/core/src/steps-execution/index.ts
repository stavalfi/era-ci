import { ExecutionStatus } from '@era-ci/utils'
import { TaskQueueBase } from '../create-task-queue'
import { ExecutionActionTypes } from './actions'
import { createCombinedEpic } from './epics'
import { createReducer } from './reducer'
import { State } from './state'
import { createReduxStore } from './store'
import { Options } from './types'

export { Actions, ChangeArtifactStatusAction, ChangeStepStatusAction } from './actions'
export { getInitialState } from './reducer'
export { State } from './state'

function findTaskQueue(options: Options & { currentStepIndex: number }): TaskQueueBase<any, any> {
  const taskQueue = options.taskQueues.find(
    t => t instanceof options.stepsToRun[options.currentStepIndex].data.taskQueueClass,
  )

  if (!taskQueue) {
    throw new Error(
      `can't find task-queue: "${options.stepsToRun[options.currentStepIndex].data.taskQueueClass.name}" for step: "${
        options.stepsToRun[options.currentStepIndex].data.stepInfo.displayName
      }" needs. did you forgot to declare the task-queue in the configuration file?`,
    )
  }

  return taskQueue
}

export async function runAllSteps(options: Options): Promise<State> {
  const runActionInSteps = await Promise.all(
    options.steps.map(async s => {
      const taskQueue = findTaskQueue({ ...options, currentStepIndex: s.index })
      const onAction = await options.stepsToRun[s.index].data.runStep({
        ...options,
        taskQueue,
        currentStepInfo: options.steps[s.index],
      })
      return onAction
    }),
  )

  const reduxStore = createReduxStore({
    epics: [createCombinedEpic({ ...options, runActionInSteps })],
    reducer: createReducer(options),
  })

  for (const step of reduxStore.getState().stepsResultOfArtifactsByStep) {
    reduxStore.dispatch({
      type: ExecutionActionTypes.step,
      payload: {
        type: ExecutionActionTypes.step,
        step: options.steps[step.index],
        stepResult: {
          executionStatus: ExecutionStatus.scheduled,
        },
      },
    })
    for (const artifact of step.data.artifactsResult) {
      reduxStore.dispatch({
        type: ExecutionActionTypes.artifactStep,
        payload: {
          type: ExecutionActionTypes.artifactStep,
          step: options.steps[step.index],
          artifact: options.artifacts[artifact.index],
          artifactStepResult: {
            executionStatus: ExecutionStatus.scheduled,
          },
        },
      })
    }
  }

  // when there are no steps, we need to exit manually:
  if (reduxStore.getState().flowFinished) {
    return reduxStore.getState()
  }

  return new Promise(res => {
    const unsubscribe = reduxStore.subscribe(() => {
      if (reduxStore.getState().flowFinished) {
        unsubscribe()
        res(reduxStore.getState())
      }
    })
  })
}
