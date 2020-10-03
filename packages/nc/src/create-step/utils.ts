import _ from 'lodash'
import { StepInfo } from '.'
import { Artifact, Graph } from '..'
import { Node } from '../types'
import { calculateCombinedStatus } from '../utils'
import {
  ExecutionStatus,
  StepsResultOfArtifact,
  StepsResultOfArtifactsByArtifact,
  StepsResultOfArtifactsByStep,
} from './types'

function getArtifactExecutionStatus({
  artifact,
  stepsResultOfArtifactsByStep,
}: {
  artifact: Node<{
    artifact: Artifact
  }>
  stepsResultOfArtifactsByStep: StepsResultOfArtifactsByStep
}): ExecutionStatus {
  // the 'if' order doesn't matter
  if (
    stepsResultOfArtifactsByStep.every(
      s =>
        s.data.stepExecutionStatus === ExecutionStatus.done &&
        s.data.artifactsResult[artifact.index].data.artifactStepExecutionStatus === ExecutionStatus.done,
    )
  ) {
    return ExecutionStatus.done
  }

  if (stepsResultOfArtifactsByStep.every(s => s.data.stepExecutionStatus === ExecutionStatus.scheduled)) {
    return ExecutionStatus.scheduled
  }

  if (
    stepsResultOfArtifactsByStep.every(
      s =>
        s.data.stepExecutionStatus === ExecutionStatus.done || s.data.stepExecutionStatus === ExecutionStatus.aborted,
    )
  ) {
    // all `artifactStepExecutionStatus` in this case are equal to `done` or `aborted`
    return ExecutionStatus.aborted
  }

  return ExecutionStatus.running
}

function getStepsResultOfArtifact({
  artifact,
  stepsResultOfArtifactsByStep,
}: {
  artifact: Node<{
    artifact: Artifact
  }>
  stepsResultOfArtifactsByStep: StepsResultOfArtifactsByStep
}): StepsResultOfArtifact {
  const artifactExecutionStatus = getArtifactExecutionStatus({ artifact, stepsResultOfArtifactsByStep })
  switch (artifactExecutionStatus) {
    case ExecutionStatus.done:
      return {
        artifactExecutionStatus: ExecutionStatus.done,
        artifact: artifact.data.artifact,
        artifactResult: {
          status: calculateCombinedStatus(
            stepsResultOfArtifactsByStep.map(s => {
              if (s.data.stepExecutionStatus !== ExecutionStatus.done) {
                throw new Error(`we can't be here because artifactExecutionStatus===done`)
              }
              return s.data.artifactsResult[artifact.index].data.artifactStepResult.status
            }),
          ),
          notes: [], // we don't support (yet) notes about a artifact
          durationMs: _.sum(
            stepsResultOfArtifactsByStep.map(s => {
              if (s.data.stepExecutionStatus !== ExecutionStatus.done) {
                throw new Error(`we can't be here because artifactExecutionStatus===done`)
              }
              return s.data.artifactsResult[artifact.index].data.artifactStepResult.durationMs
            }),
          ),
        },
        stepsResult: stepsResultOfArtifactsByStep.map(s => {
          if (s.data.stepExecutionStatus !== ExecutionStatus.done) {
            throw new Error(`we can't be here`)
          }
          return {
            ...s,
            data: {
              stepInfo: s.data.stepInfo,
              artifactStepExecutionStatus: s.data.artifactsResult[artifact.index].data.artifactStepExecutionStatus,
              artifactStepResult: s.data.artifactsResult[artifact.index].data.artifactStepResult,
            },
          }
        }),
      }
    case ExecutionStatus.aborted: {
      return {
        artifactExecutionStatus: ExecutionStatus.aborted,
        artifact: artifact.data.artifact,
        artifactResult: {
          status: calculateCombinedStatus(
            _.flatten(
              stepsResultOfArtifactsByStep.map(s =>
                s.data.stepExecutionStatus === ExecutionStatus.done ||
                s.data.stepExecutionStatus === ExecutionStatus.aborted
                  ? [s.data.artifactsResult[artifact.index].data.artifactStepResult.status]
                  : [],
              ),
            ),
          ),
          notes: [], // we don't support (yet) notes about a artifact
          durationMs: _.sum(
            stepsResultOfArtifactsByStep.map(s =>
              s.data.stepExecutionStatus === ExecutionStatus.done ||
              s.data.stepExecutionStatus === ExecutionStatus.aborted
                ? s.data.artifactsResult[artifact.index].data.artifactStepResult.durationMs
                : 0,
            ),
          ),
        },
        stepsResult: stepsResultOfArtifactsByStep.map(s => {
          switch (s.data.stepExecutionStatus) {
            case ExecutionStatus.done:
              return {
                ...s,
                data: {
                  stepInfo: s.data.stepInfo,
                  artifactStepExecutionStatus: ExecutionStatus.done,
                  artifactStepResult: s.data.artifactsResult[artifact.index].data.artifactStepResult,
                },
              }
            case ExecutionStatus.aborted: {
              const sResult = s.data.artifactsResult[artifact.index].data
              switch (sResult.artifactStepExecutionStatus) {
                case ExecutionStatus.done:
                  return {
                    ...s,
                    data: {
                      stepInfo: s.data.stepInfo,
                      artifactStepExecutionStatus: ExecutionStatus.done,
                      artifactStepResult: sResult.artifactStepResult,
                    },
                  }
                case ExecutionStatus.aborted:
                  return {
                    ...s,
                    data: {
                      stepInfo: s.data.stepInfo,
                      artifactStepExecutionStatus: ExecutionStatus.aborted,
                      artifactStepResult: sResult.artifactStepResult,
                    },
                  }
              }
              throw new Error(`we can't be here but typescript wants us to use 'break' command`)
            }
            case ExecutionStatus.running:
            case ExecutionStatus.scheduled:
              throw new Error(
                `we can't be here. if artifactExecutionStatus===ExecutionStatus.aborted then s.data.stepExecutionStatus===done/aborted only. if we are here, then this statement is false`,
              )
          }
        }),
      }
    }
    case ExecutionStatus.running:
      return {
        artifactExecutionStatus: ExecutionStatus.running,
        artifact: artifact.data.artifact,
        stepsResult: stepsResultOfArtifactsByStep.map(s => {
          switch (s.data.stepExecutionStatus) {
            case ExecutionStatus.done:
              return {
                ...s,
                data: {
                  stepInfo: s.data.stepInfo,
                  artifactStepExecutionStatus: ExecutionStatus.done,
                  artifactStepResult: s.data.artifactsResult[artifact.index].data.artifactStepResult,
                },
              }
            case ExecutionStatus.aborted: {
              const sResult = s.data.artifactsResult[artifact.index].data
              switch (sResult.artifactStepExecutionStatus) {
                case ExecutionStatus.done:
                  return {
                    ...s,
                    data: {
                      stepInfo: s.data.stepInfo,
                      artifactStepExecutionStatus: ExecutionStatus.done,
                      artifactStepResult: sResult.artifactStepResult,
                    },
                  }
                case ExecutionStatus.aborted:
                  return {
                    ...s,
                    data: {
                      stepInfo: s.data.stepInfo,
                      artifactStepExecutionStatus: ExecutionStatus.aborted,
                      artifactStepResult: sResult.artifactStepResult,
                    },
                  }
              }
              throw new Error(`we can't be here but typescript wants us to use 'break' command`)
            }
            case ExecutionStatus.running:
            case ExecutionStatus.scheduled:
              return {
                ...s,
                data: {
                  stepInfo: s.data.stepInfo,
                  artifactStepExecutionStatus: s.data.stepExecutionStatus,
                  artifactStepResult: s.data.artifactsResult,
                },
              }
          }
        }),
      }
    case ExecutionStatus.scheduled:
      return {
        artifactExecutionStatus: ExecutionStatus.scheduled,
        artifact: artifact.data.artifact,
        stepsResult: stepsResultOfArtifactsByStep.map(s => {
          return {
            ...s,
            data: {
              artifactStepExecutionStatus: ExecutionStatus.scheduled,
              stepInfo: s.data.stepInfo,
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
