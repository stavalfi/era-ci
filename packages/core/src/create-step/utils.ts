import {
  Artifact,
  calculateCombinedStatus,
  calculateExecutionStatus,
  ExecutionStatus,
  Graph,
  Node,
  Status,
  StepInfo,
} from '@era-ci/utils'
import _ from 'lodash'
import { ChangeArtifactStatusAction, ChangeStepStatusAction } from '../steps-execution'
import { ExecutionActionTypes } from '../steps-execution/actions'
import {
  StepResultOfArtifacts,
  StepsResultOfArtifact,
  StepsResultOfArtifactsByArtifact,
  StepsResultOfArtifactsByStep,
} from './types'

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
}): ChangeArtifactStatusAction[] =>
  artifacts.map<ChangeArtifactStatusAction>(artifact => ({
    type: ExecutionActionTypes.artifactStep,
    payload: {
      artifact,
      step,
      artifactStepResult: {
        executionStatus: ExecutionStatus.running,
      },
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
}): ChangeArtifactStatusAction[] =>
  artifacts.map<ChangeArtifactStatusAction>(artifact => ({
    type: ExecutionActionTypes.artifactStep,
    payload: {
      artifact,
      step,
      artifactStepResult: {
        durationMs: Date.now() - startStepMs,
        executionStatus: ExecutionStatus.done,
        status,
        errors: [],
        notes: [],
      },
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
}): ChangeArtifactStatusAction[] =>
  artifacts.map<ChangeArtifactStatusAction>(artifact => ({
    type: ExecutionActionTypes.artifactStep,
    payload: {
      artifact,
      step,
      artifactStepResult: {
        durationMs: Date.now() - startStepMs,
        executionStatus: ExecutionStatus.aborted,
        status,
        errors: [],
        notes: [],
      },
    },
  }))

export const stepEventRunning = ({
  step,
}: {
  step: Node<{
    stepInfo: StepInfo
  }>
}): ChangeStepStatusAction => ({
  type: ExecutionActionTypes.step,
  payload: {
    step,
    stepResult: {
      executionStatus: ExecutionStatus.running,
    },
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
}): ChangeStepStatusAction => ({
  type: ExecutionActionTypes.step,
  payload: {
    step,
    stepResult: {
      durationMs: Date.now() - startStepMs,
      executionStatus: ExecutionStatus.done,
      status: Status.passed,
      errors: [],
      notes: [],
    },
  },
})

export function calculateCombinedStatusOfCurrentStep(
  artifactResultsOnCurrentStep: ChangeArtifactStatusAction[],
): Status {
  return calculateCombinedStatus(
    _.flatMapDeep(
      artifactResultsOnCurrentStep.map(a =>
        a.payload.artifactStepResult.executionStatus === ExecutionStatus.done ||
        a.payload.artifactStepResult.executionStatus === ExecutionStatus.aborted
          ? [a.payload.artifactStepResult.status]
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

function getStepsResultOfArtifact({
  artifact,
  stepsResultOfArtifactsByStep,
}: {
  artifact: Node<{
    artifact: Artifact
  }>
  stepsResultOfArtifactsByStep: StepsResultOfArtifactsByStep
}): StepsResultOfArtifact {
  const artifactExecutionStatus = calculateExecutionStatus(
    stepsResultOfArtifactsByStep.map(
      s => s.data.artifactsResult[artifact.index].data.artifactStepResult.executionStatus,
    ),
  )

  switch (artifactExecutionStatus) {
    case ExecutionStatus.done:
      return {
        artifactExecutionStatus: ExecutionStatus.done,
        artifact: artifact.data.artifact,
        artifactResult: {
          executionStatus: ExecutionStatus.done,
          status: calculateCombinedStatus(
            stepsResultOfArtifactsByStep
              .map(s => s.data.artifactsResult[artifact.index].data.artifactStepResult)
              .map(artifactStepResult => {
                if (
                  artifactStepResult.executionStatus !== ExecutionStatus.done &&
                  artifactStepResult.executionStatus !== ExecutionStatus.aborted
                ) {
                  throw new Error(`we can't be here1`)
                }
                return artifactStepResult.status
              }),
          ) as Status.failed | Status.passed,
          notes: [], // we don't support (yet) notes about a artifact
          errors: [], // we don't support (yet) errors about a artifact
          durationMs: _.sum(
            stepsResultOfArtifactsByStep.map(s => {
              const a = s.data.artifactsResult[artifact.index].data.artifactStepResult
              if (a.executionStatus !== ExecutionStatus.done && a.executionStatus !== ExecutionStatus.aborted) {
                throw new Error(`we can't be here2`)
              }
              return a.durationMs
            }),
          ),
        },
        stepsResult: stepsResultOfArtifactsByStep.map(s => {
          const artifactStepResult = s.data.artifactsResult[artifact.index].data.artifactStepResult
          if (
            artifactStepResult.executionStatus !== ExecutionStatus.done &&
            artifactStepResult.executionStatus !== ExecutionStatus.aborted
          ) {
            throw new Error(`we can't be here3`)
          }
          return {
            ...s,
            data: {
              stepInfo: s.data.stepInfo,
              artifactStepResult,
            },
          }
        }),
      }
    case ExecutionStatus.aborted: {
      return {
        artifactExecutionStatus: ExecutionStatus.aborted,
        artifact: artifact.data.artifact,
        artifactResult: {
          executionStatus: ExecutionStatus.aborted,
          status: calculateCombinedStatus(
            stepsResultOfArtifactsByStep.map(s => {
              const a = s.data.artifactsResult[artifact.index].data.artifactStepResult
              if (a.executionStatus !== ExecutionStatus.aborted) {
                throw new Error(`we can't be here4`)
              }
              return a.status
            }),
          ),
          durationMs: _.sum(
            stepsResultOfArtifactsByStep.map(s => {
              const a = s.data.artifactsResult[artifact.index].data.artifactStepResult
              if (a.executionStatus !== ExecutionStatus.aborted) {
                throw new Error(`we can't be here5`)
              }
              return a.durationMs ?? 0
            }),
          ),
          notes: [], // we don't support (yet) notes about a artifact
          errors: [], // we don't support (yet) errors about a artifact
        },
        stepsResult: stepsResultOfArtifactsByStep.map(s => {
          const a = s.data.artifactsResult[artifact.index].data.artifactStepResult
          if (a.executionStatus !== ExecutionStatus.aborted) {
            throw new Error(`we can't be here6`)
          }
          return {
            ...s,
            data: {
              stepInfo: s.data.stepInfo,
              artifactStepResult: a,
            },
          }
        }),
      }
    }
    case ExecutionStatus.running:
      return {
        artifactExecutionStatus: ExecutionStatus.running,
        artifact: artifact.data.artifact,
        artifactResult: {
          executionStatus: ExecutionStatus.running,
        },
        stepsResult: stepsResultOfArtifactsByStep.map(s => {
          return {
            ...s,
            data: {
              stepInfo: s.data.stepInfo,
              artifactStepResult: s.data.artifactsResult[artifact.index].data.artifactStepResult,
            },
          }
        }),
      }
    case ExecutionStatus.scheduled:
      return {
        artifactExecutionStatus: ExecutionStatus.scheduled,
        artifact: artifact.data.artifact,
        artifactResult: {
          executionStatus: ExecutionStatus.scheduled,
        },
        stepsResult: stepsResultOfArtifactsByStep.map(s => {
          const a = s.data.artifactsResult[artifact.index].data.artifactStepResult
          if (a.executionStatus !== ExecutionStatus.scheduled) {
            throw new Error(`we can't be here7`)
          }
          return {
            ...s,
            data: {
              stepInfo: s.data.stepInfo,
              artifactStepResult: a,
            },
          }
        }),
      }
  }
}

export function toStepsResultOfArtifactsByArtifact({
  artifacts,
  stepsResultOfArtifactsByStep,
}: {
  artifacts: Graph<{ artifact: Artifact }>
  stepsResultOfArtifactsByStep: StepsResultOfArtifactsByStep
}): StepsResultOfArtifactsByArtifact {
  return artifacts.map(a => ({
    ...a,
    data: getStepsResultOfArtifact({ artifact: a, stepsResultOfArtifactsByStep }),
  }))
}

export function stepToString({
  steps,
  stepInfo,
}: {
  stepInfo: StepInfo
  steps: Graph<{ stepInfo: StepInfo }>
}): string {
  const isStepAppearsMultipleTimes = steps.filter(s => s.data.stepInfo.stepName === stepInfo.stepName).length > 1
  return isStepAppearsMultipleTimes ? stepInfo.stepId : stepInfo.stepName
}
