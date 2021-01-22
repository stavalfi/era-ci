import { Artifact, ExecutionStatus, Graph, StepInfo } from '@era-ci/utils'
import { produce } from 'immer'
import { Reducer } from 'redux'
import { StepsResultOfArtifactsByStep, toStepsResultOfArtifactsByArtifact } from '../create-step'
import { Actions, ExecutionActionTypes } from './actions'
import { State } from './state'

const areAllStepsFinished = (stepsResultOfArtifactsByStep: State['stepsResultOfArtifactsByStep']) =>
  stepsResultOfArtifactsByStep.every(step =>
    [ExecutionStatus.aborted, ExecutionStatus.done].includes(step.data.stepExecutionStatus),
  )

function getInitialState({
  artifacts,
  steps,
}: {
  artifacts: Graph<{ artifact: Artifact }>
  steps: Graph<{ stepInfo: StepInfo }>
}): State {
  if (steps.length === 0) {
    return {
      flowFinished: true,
      stepsResultOfArtifactsByStep: [],
      stepsResultOfArtifactsByArtifact: toStepsResultOfArtifactsByArtifact({
        artifacts: artifacts,
        stepsResultOfArtifactsByStep: [],
      }),
    }
  }

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

  return state
}

const numbericExecutionStatus: { [a in keyof typeof ExecutionStatus]: number } = {
  scheduled: 0,
  running: 1,
  aborted: 2, // aboreted and done has the same numeric value because they both represents final execution status
  done: 2,
}

export const createReducer = (options: {
  artifacts: Graph<{ artifact: Artifact }>
  steps: Graph<{ stepInfo: StepInfo }>
}): Reducer<State, Actions> => (state = getInitialState(options), action) => {
  if (action.type.toLocaleLowerCase().includes('@@redux/init')) {
    return state
  }

  const state1 = produce(state, draftState => {
    switch (action.type) {
      case ExecutionActionTypes.step: {
        const stepResult = draftState.stepsResultOfArtifactsByStep[action.payload.step.index].data
        if (
          numbericExecutionStatus[stepResult.stepExecutionStatus] >=
          numbericExecutionStatus[action.payload.stepResult.executionStatus]
        ) {
          // it means that this action came too late to the reducer and in the meanwhile, the state already changed.
          return
        }
        stepResult.stepExecutionStatus = action.payload.stepResult.executionStatus
        stepResult.stepResult = action.payload.stepResult
        break
      }
      case ExecutionActionTypes.artifactStep: {
        const stepResult = draftState.stepsResultOfArtifactsByStep[action.payload.step.index].data
        if (
          numbericExecutionStatus[
            stepResult.artifactsResult[action.payload.artifact.index].data.artifactStepResult.executionStatus
          ] >= numbericExecutionStatus[action.payload.artifactStepResult.executionStatus]
        ) {
          // it means that this action came too late to the reducer and in the meanwhile, the state already changed.
          return
        }
        stepResult.artifactsResult[action.payload.artifact.index].data.artifactStepResult =
          action.payload.artifactStepResult
        break
      }
    }
  })

  const state2 = produce(state1, draftState => {
    draftState.stepsResultOfArtifactsByArtifact = toStepsResultOfArtifactsByArtifact({
      artifacts: options.artifacts,
      stepsResultOfArtifactsByStep: state1.stepsResultOfArtifactsByStep,
    })
  })

  const state3 = produce(state2, draftState => {
    if (areAllStepsFinished(state2.stepsResultOfArtifactsByStep)) {
      draftState.flowFinished = true
    }
  })

  return state3
}
