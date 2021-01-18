import {
  AbortResult,
  Artifact,
  calculateCombinedStatus,
  didPassOrSkippedAsPassed,
  DoneResult,
  ExecutionStatus,
  Graph,
  RunningResult,
  ScheduledResult,
  Status,
  StepInfo,
} from '@era-ci/utils'
import _ from 'lodash'
import { StepsResultOfArtifactsByStep } from './create-step'
import { State } from './steps-execution'

export function getEventsTopicName(env: NodeJS.ProcessEnv): string {
  const topic = 'era-ci-events'
  const postfix = env['ERA_CI_EVENTS_TOPIC_PREFIX']
  if (postfix) {
    return `${topic}-${postfix}`
  } else {
    return topic
  }
}

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

export const getResult = (
  options: {
    state: State
    artifacts: Graph<{ artifact: Artifact }>
    steps: Graph<{ stepInfo: StepInfo }>
    artifactName: string
  } & ({ stepId: string } | { stepGroup: string }),
):
  | ScheduledResult
  | RunningResult
  | DoneResult
  | AbortResult<Status.skippedAsFailed | Status.skippedAsPassed | Status.failed> => {
  const artifactIndex = options.artifacts.findIndex(a => a.data.artifact.packageJson.name === options.artifactName)
  if (artifactIndex < 0) {
    throw new Error(`artifactName: "${options.artifactName}" not found`)
  }

  const stepIndex = options.steps.findIndex(a =>
    'stepId' in options ? a.data.stepInfo.stepId === options.stepId : a.data.stepInfo.stepGroup === options.stepGroup,
  )
  if (stepIndex < 0) {
    if ('stepId' in options) {
      throw new Error(`'step-id': "${options.stepId}" not found`)
    } else {
      throw new Error(`'step-group': "${options.stepGroup}" not found`)
    }
  }

  return options.state.stepsResultOfArtifactsByStep[stepIndex].data.artifactsResult[artifactIndex].data
    .artifactStepResult
}

export const getReturnValue = <T>(
  options: {
    state: State
    artifacts: Graph<{ artifact: Artifact }>
    steps: Graph<{ stepInfo: StepInfo }>
    artifactName: string
    mapper: (val?: string) => T
    allowUndefined?: boolean
  } & ({ stepId: string } | { stepGroup: string }),
): T => {
  const artifactStepResult = getResult(options)
  if (
    artifactStepResult.executionStatus !== ExecutionStatus.aborted &&
    artifactStepResult.executionStatus !== ExecutionStatus.done
  ) {
    if ('stepId' in options) {
      throw new Error(`'step-id': "${options.stepId}" not done yet so we can't get it's return value`)
    } else {
      throw new Error(`'step-group': "${options.stepGroup}" not done yet so we can't get it's return value`)
    }
  }
  const result = options.mapper(artifactStepResult.returnValue)
  if (result === undefined) {
    throw new Error(`invalid return-value from step: "undefined"`)
  }
  return result
}
