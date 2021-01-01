import { Artifact, calculateCombinedStatus, ExecutionStatus, Graph, Node, Status } from '@era-ci/utils'
import _ from 'lodash'
import {
  StepInfo,
  StepOutputEvents,
  StepOutputEventType,
  StepResultOfArtifacts,
  StepsResultOfArtifact,
  StepsResultOfArtifactsByStep,
} from '../types'

export const artifactsEventsRunning = ({
  artifacts,
  step,
}: {
  artifacts: Graph<{
    artifact: Artifact
  }>
  step: Node<{
    stepInfo: StepInfo
  }>
}): StepOutputEvents[StepOutputEventType.artifactStep][] =>
  artifacts.map<StepOutputEvents[StepOutputEventType.artifactStep]>(artifact => ({
    type: StepOutputEventType.artifactStep,
    artifact,
    step,
    artifactStepResult: {
      executionStatus: ExecutionStatus.running,
    },
  }))

export const artifactsEventsDone = ({
  status,
  artifacts,
  startStepMs,
  step,
}: {
  status: Status.failed | Status.passed
  artifacts: Graph<{
    artifact: Artifact
  }>
  step: Node<{
    stepInfo: StepInfo
  }>
  startStepMs: number
}): StepOutputEvents[StepOutputEventType.artifactStep][] =>
  artifacts.map<StepOutputEvents[StepOutputEventType.artifactStep]>(artifact => ({
    type: StepOutputEventType.artifactStep,
    artifact,
    step,
    artifactStepResult: {
      durationMs: Date.now() - startStepMs,
      executionStatus: ExecutionStatus.done,
      status,
      errors: [],
      notes: [],
    },
  }))

export const artifactsEventsAbort = ({
  status,
  artifacts,
  startStepMs,
  step,
}: {
  status: Status.skippedAsFailed | Status.skippedAsPassed | Status.failed
  artifacts: Graph<{
    artifact: Artifact
  }>
  step: Node<{
    stepInfo: StepInfo
  }>
  startStepMs: number
}): StepOutputEvents[StepOutputEventType.artifactStep][] =>
  artifacts.map<StepOutputEvents[StepOutputEventType.artifactStep]>(artifact => ({
    type: StepOutputEventType.artifactStep,
    artifact,
    step,
    artifactStepResult: {
      durationMs: Date.now() - startStepMs,
      executionStatus: ExecutionStatus.aborted,
      status,
      errors: [],
      notes: [],
    },
  }))

export const stepEventRunning = ({
  step,
}: {
  step: Node<{
    stepInfo: StepInfo
  }>
}): StepOutputEvents[StepOutputEventType.step] => ({
  type: StepOutputEventType.step,
  step,
  stepResult: {
    executionStatus: ExecutionStatus.running,
  },
})

export const stepEventDone = ({
  step,
  startStepMs,
}: {
  startStepMs: number
  step: Node<{
    stepInfo: StepInfo
  }>
}): StepOutputEvents[StepOutputEventType.step] => ({
  type: StepOutputEventType.step,
  step,
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

export function areRecursiveParentStepsFinished({
  stepsResultOfArtifactsByStep,
  stepIndex,
}: {
  stepsResultOfArtifactsByStep: StepsResultOfArtifactsByStep
  stepIndex: number
}): boolean {
  const stepResult = stepsResultOfArtifactsByStep[stepIndex]
  const parentSteps = stepResult.parentsIndexes
  return parentSteps.every(
    p =>
      (stepsResultOfArtifactsByStep[p].data.stepResult.executionStatus === ExecutionStatus.aborted ||
        stepsResultOfArtifactsByStep[p].data.stepResult.executionStatus === ExecutionStatus.done) &&
      areRecursiveParentStepsFinished({
        stepsResultOfArtifactsByStep,
        stepIndex: p,
      }),
  )
}

export function areRecursiveParentStepsFinishedOnArtifact({
  stepsResultOfArtifactsByArtifact,
  artifactIndex,
  steps,
  stepIndex,
}: {
  stepsResultOfArtifactsByArtifact: Graph<StepsResultOfArtifact>
  artifactIndex: number
  steps: Graph<{
    stepInfo: StepInfo
  }>
  stepIndex: number
}): boolean {
  const { stepsResult } = stepsResultOfArtifactsByArtifact[artifactIndex].data
  const parentSteps = steps[stepIndex].parentsIndexes
  return parentSteps.every(
    p =>
      (stepsResult[p].data.artifactStepResult.executionStatus === ExecutionStatus.aborted ||
        stepsResult[p].data.artifactStepResult.executionStatus === ExecutionStatus.done) &&
      areRecursiveParentStepsFinishedOnArtifact({
        artifactIndex,
        stepsResultOfArtifactsByArtifact,
        steps,
        stepIndex: p,
      }),
  )
}

export const areArtifactParentsFinishedParentSteps = ({
  stepsResultOfArtifactsByStep,
  artifactIndex,
  artifacts,
  stepIndex,
}: {
  stepsResultOfArtifactsByStep: Graph<StepResultOfArtifacts>
  artifactIndex: number
  artifacts: Graph<{
    artifact: Artifact
  }>
  stepIndex: number
}): boolean =>
  stepsResultOfArtifactsByStep[stepIndex].parentsIndexes.every(parentStepIndex =>
    artifacts[artifactIndex].parentsIndexes.every(parentArtifactIndex => {
      return [ExecutionStatus.aborted, ExecutionStatus.done].includes(
        stepsResultOfArtifactsByStep[parentStepIndex].data.artifactsResult[parentArtifactIndex].data.artifactStepResult
          .executionStatus,
      )
    }),
  )
