import { ExecutionStatus, StepOutputEventType } from '@era-ci/utils'
import { createCombinedEpic } from './epics'
import { createReducer } from './reducer'
import { State } from './state'
import { createReduxStore } from './store'
import { Options } from './types'
import { areAllStepsFinished } from './utils'

export { Actions, ChangeArtifactStatusAction, ChangeStepStatusAction } from './actions'
export { State } from './state'

export async function runAllSteps(options: Options): Promise<State> {
  console.log('stav1')
  const reduxStore = createReduxStore({
    epics: [createCombinedEpic(options)],
    reducer: createReducer(options),
  })

  for (const step of reduxStore.getState().stepsResultOfArtifactsByStep) {
    reduxStore.dispatch({
      type: StepOutputEventType.step,
      payload: {
        type: StepOutputEventType.step,
        step: options.steps[step.index],
        stepResult: {
          executionStatus: ExecutionStatus.scheduled,
        },
      },
    })
    for (const artifact of step.data.artifactsResult) {
      reduxStore.dispatch({
        type: StepOutputEventType.artifactStep,
        payload: {
          type: StepOutputEventType.artifactStep,
          step: options.steps[step.index],
          artifact: options.artifacts[artifact.index],
          artifactStepResult: {
            executionStatus: ExecutionStatus.scheduled,
          },
        },
      })
    }
  }

  // incase there are no steps, we need to exit early
  if (areAllStepsFinished(reduxStore.getState())) {
    return reduxStore.getState()
  }

  return new Promise(res => {
    const unsubscribe = reduxStore.subscribe(() => {
      if (areAllStepsFinished(reduxStore.getState())) {
        unsubscribe()
        res(reduxStore.getState())
      }
    })
  })
}
