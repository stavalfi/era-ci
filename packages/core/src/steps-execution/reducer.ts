import { Artifact, ExecutionStatus, Graph, StepInfo, StepOutputEventType } from '@era-ci/utils'
import _ from 'lodash'
import { Reducer } from 'redux'
import { toStepsResultOfArtifactsByArtifact } from '../create-step'
import { State } from './state'
import { Actions } from './actions'
import { StepsResultOfArtifactsByArtifact, StepsResultOfArtifactsByStep } from '../create-step'

export function getInitialState({
  artifacts,
  steps,
}: {
  artifacts: Graph<{ artifact: Artifact }>
  steps: Graph<{ stepInfo: StepInfo }>
}): {
  stepsResultOfArtifactsByStep: StepsResultOfArtifactsByStep
  stepsResultOfArtifactsByArtifact: StepsResultOfArtifactsByArtifact
} {
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

  return {
    stepsResultOfArtifactsByStep,
    stepsResultOfArtifactsByArtifact: toStepsResultOfArtifactsByArtifact({
      artifacts: artifacts,
      stepsResultOfArtifactsByStep,
    }),
  }
}

export const createReducer = (options: {
  artifacts: Graph<{ artifact: Artifact }>
  steps: Graph<{ stepInfo: StepInfo }>
}): Reducer<State, Actions> => (state = getInitialState(options), action) => {
  const newState = _.cloneDeep(state)
  const stepResult = newState.stepsResultOfArtifactsByStep[action.payload.step.index].data
  switch (action.type) {
    case StepOutputEventType.step:
      stepResult.stepExecutionStatus = action.payload.stepResult.executionStatus
      stepResult.stepResult = action.payload.stepResult
      break
    case StepOutputEventType.artifactStep:
      stepResult.artifactsResult[action.payload.artifact.index].data.artifactStepResult =
        action.payload.artifactStepResult
      break
  }
  newState.stepsResultOfArtifactsByArtifact = toStepsResultOfArtifactsByArtifact({
    artifacts: options.artifacts,
    stepsResultOfArtifactsByStep: newState.stepsResultOfArtifactsByStep,
  })
  return newState
}
