import _ from 'lodash'
import { StepInfo } from '.'
import {
  calculateCombinedStatus,
  calculateExecutionStatus,
  Artifact,
  ExecutionStatus,
  Graph,
  Node,
  Status,
} from '@era-ci/utils'
import { StepsResultOfArtifact, StepsResultOfArtifactsByArtifact, StepsResultOfArtifactsByStep } from './types'

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
