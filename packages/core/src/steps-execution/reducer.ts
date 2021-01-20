import { Artifact, ExecutionStatus, Graph, StepInfo } from '@era-ci/utils'
import _ from 'lodash'
import { Reducer } from 'redux'
import { StepsResultOfArtifactsByStep, toStepsResultOfArtifactsByArtifact } from '../create-step'
import { Actions, ExecutionActionTypes } from './actions'
import { State } from './state'

export const areAllStepsFinished = (stepsResultOfArtifactsByStep: State['stepsResultOfArtifactsByStep']) =>
  stepsResultOfArtifactsByStep.every(step =>
    [ExecutionStatus.aborted, ExecutionStatus.done].includes(step.data.stepExecutionStatus),
  )

export function getInitialState({
  artifacts,
  steps,
}: {
  artifacts: Graph<{ artifact: Artifact }>
  steps: Graph<{ stepInfo: StepInfo }>
}): State {
  const stepsResultOfArtifactsByStep: StepsResultOfArtifactsByStep = steps.map(s => ({
    ...s,
    data: {
      stepExecutionStatus: ExecutionStatus.scheduled,
      stepInfo: s.data.stepInfo,
      stepResult: {
        executionStatus: ExecutionStatus.scheduled,
      },
      artifactsResult: artifacts.map(a => ({
        ...a,
        data: {
          artifact: a.data.artifact,
          artifactStepResult: {
            executionStatus: ExecutionStatus.scheduled,
          },
        },
      })),
    },
  }))

  const state: State = {
    flowFinished: false,
    stepsResultOfArtifactsByStep,
    stepsResultOfArtifactsByArtifact: toStepsResultOfArtifactsByArtifact({
      artifacts: artifacts,
      stepsResultOfArtifactsByStep,
    }),
  }

  if (areAllStepsFinished(state.stepsResultOfArtifactsByStep)) {
    state.flowFinished = true
  }

  return state
}

export const createReducer = (options: {
  artifacts: Graph<{ artifact: Artifact }>
  steps: Graph<{ stepInfo: StepInfo }>
}): Reducer<State, Actions> => (state = getInitialState(options), action) => {
  if (action.type.toLocaleLowerCase().includes('@@redux/init')) {
    return state
  }

  const newState = _.cloneDeep(state)
  switch (action.type) {
    case ExecutionActionTypes.step: {
      if (state.flowFinished) {
        throw new Error(`we can't be here`)
      }
      const stepResult = newState.stepsResultOfArtifactsByStep[action.payload.step.index].data
      stepResult.stepExecutionStatus = action.payload.stepResult.executionStatus
      stepResult.stepResult = action.payload.stepResult
      break
    }
    case ExecutionActionTypes.artifactStep: {
      if (state.flowFinished) {
        throw new Error(`we can't be here`)
      }
      const stepResult = newState.stepsResultOfArtifactsByStep[action.payload.step.index].data
      stepResult.artifactsResult[action.payload.artifact.index].data.artifactStepResult =
        action.payload.artifactStepResult
      break
    }
  }

  newState.stepsResultOfArtifactsByArtifact = toStepsResultOfArtifactsByArtifact({
    artifacts: options.artifacts,
    stepsResultOfArtifactsByStep: newState.stepsResultOfArtifactsByStep,
  })

  if (areAllStepsFinished(newState.stepsResultOfArtifactsByStep)) {
    newState.flowFinished = true
  }

  return newState
}
