import { Artifact, calculateCombinedStatus, ExecutionStatus, Graph, Node, Status } from '@tahini/utils'
import _ from 'lodash'
import { StepInfo, StepOutputEvents, StepOutputEventType, StepResultOfArtifacts, StepsResultOfArtifact } from '../types'

export const artifactsEventsRunning = (
  artifacts: Graph<{
    artifact: Artifact
  }>,
): StepOutputEvents[StepOutputEventType.artifactStep][] =>
  artifacts.map<StepOutputEvents[StepOutputEventType.artifactStep]>(artifact => ({
    type: StepOutputEventType.artifactStep,
    artifact,
    artifactStepResult: {
      executionStatus: ExecutionStatus.running,
    },
  }))

export const artifactsEventsDone = ({
  asFailed,
  artifacts,
  startStepMs,
}: {
  asFailed?: boolean
  artifacts: Graph<{
    artifact: Artifact
  }>
  startStepMs: number
}): StepOutputEvents[StepOutputEventType.artifactStep][] =>
  artifacts.map<StepOutputEvents[StepOutputEventType.artifactStep]>(artifact => ({
    type: StepOutputEventType.artifactStep,
    artifact,
    artifactStepResult: {
      durationMs: Date.now() - startStepMs,
      executionStatus: ExecutionStatus.done,
      status: asFailed ? Status.failed : Status.passed,
      errors: [],
      notes: [],
    },
  }))

export const stepEventRunning = (): StepOutputEvents[StepOutputEventType.step] => ({
  type: StepOutputEventType.step,
  stepResult: {
    executionStatus: ExecutionStatus.running,
  },
})

export const stepEventDone = (startStepMs: number): StepOutputEvents[StepOutputEventType.step] => ({
  type: StepOutputEventType.step,
  stepResult: {
    durationMs: Date.now() - startStepMs,
    executionStatus: ExecutionStatus.done,
    status: Status.passed,
    errors: [],
    notes: [],
  },
})

export function calculateCombinedStatusOfCurrentStep(
  artifactResultsOnCurrentStep: StepOutputEvents[StepOutputEventType.artifactStep][],
): Status {
  return calculateCombinedStatus(
    _.flatMapDeep(
      artifactResultsOnCurrentStep.map(a =>
        a.artifactStepResult.executionStatus === ExecutionStatus.done ||
        a.artifactStepResult.executionStatus === ExecutionStatus.aborted
          ? [a.artifactStepResult.status]
          : [],
      ),
    ),
  )
}

export const areStepsDoneOnArtifact = ({
  stepsResultOfArtifactsByArtifact,
  artifactIndex,
  currentStepInfo,
}: {
  stepsResultOfArtifactsByArtifact: Graph<StepsResultOfArtifact>
  artifactIndex: number
  currentStepInfo: Node<{
    stepInfo: StepInfo
  }>
}): boolean => {
  const stepsOfArtifact = stepsResultOfArtifactsByArtifact[artifactIndex].data.stepsResult
  const parentSteps = currentStepInfo.parentsIndexes
  return parentSteps.every(
    p =>
      stepsOfArtifact[p].data.artifactStepResult.executionStatus === ExecutionStatus.aborted ||
      stepsOfArtifact[p].data.artifactStepResult.executionStatus === ExecutionStatus.done,
  )
}

export const didAllStepsAborted = ({
  stepsResultOfArtifactsByStep,
  currentStepInfo,
}: {
  stepsResultOfArtifactsByStep: Graph<StepResultOfArtifacts>
  currentStepInfo: Node<{
    stepInfo: StepInfo
  }>
}): boolean =>
  stepsResultOfArtifactsByStep[currentStepInfo.index].data.artifactsResult.every(
    a => a.data.artifactStepResult.executionStatus === ExecutionStatus.aborted,
  )
