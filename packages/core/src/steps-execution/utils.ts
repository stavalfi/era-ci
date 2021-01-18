import { ExecutionStatus } from '@era-ci/utils'
import { State } from './state'

export const areAllStepsFinished = (state: State) =>
  state.stepsResultOfArtifactsByStep.every(step =>
    [ExecutionStatus.aborted, ExecutionStatus.done].includes(step.data.stepExecutionStatus),
  )
