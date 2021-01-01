import {
  Artifact,
  calculateCombinedStatus,
  didPassOrSkippedAsPassed,
  ExecutionStatus,
  Graph,
  Status,
} from '@era-ci/utils'
import _ from 'lodash'
import {
  StepInfo,
  StepsResultOfArtifactsByArtifact,
  StepsResultOfArtifactsByStep,
  toStepsResultOfArtifactsByArtifact,
} from './create-step'

export function getExitCode(stepsResultOfArtifactsByStep: StepsResultOfArtifactsByStep): number {
  const finalStepsStatus = calculateCombinedStatus(
    _.flatMapDeep(
      stepsResultOfArtifactsByStep.map(s => {
        switch (s.data.stepExecutionStatus) {
          case ExecutionStatus.done:
            return s.data.artifactsResult.map(y => y.data.artifactStepResult.status)
          case ExecutionStatus.aborted:
            return s.data.artifactsResult.map(y => y.data.artifactStepResult.status)
          case ExecutionStatus.running:
            return [Status.failed]
          case ExecutionStatus.scheduled:
            return [Status.failed]
        }
      }),
    ),
  )
  if (didPassOrSkippedAsPassed(finalStepsStatus)) {
    return 0
  } else {
    return 1
  }
}

export function getStepsResultOfArtifactsByStepAndArtifact({
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
