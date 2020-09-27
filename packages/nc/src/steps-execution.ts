import fse from 'fs-extra'
import _ from 'lodash'
import path from 'path'
import { Cache } from './create-cache'
import { Logger } from './create-logger'
import {
  ExecutionStatus,
  Status,
  Step,
  StepInfo,
  StepsResultOfArtifact,
  StepsResultOfArtifactsByArtifact,
  StepsResultOfArtifactsByStep,
} from './create-step'
import { Artifact, Graph, Node, PackageJson } from './types'
import { calculateCombinedStatus } from './utils'

function getArtifactExecutionStatus({
  artifact,
  stepsResultOfArtifactsByStep,
}: {
  artifact: Node<{
    artifact: Artifact
  }>
  stepsResultOfArtifactsByStep: StepsResultOfArtifactsByStep<unknown>
}): ExecutionStatus {
  // the order of the 'if'a is important:
  if (
    stepsResultOfArtifactsByStep.every(
      s =>
        s.data.stepExecutionStatus === ExecutionStatus.done &&
        s.data.artifactsResult[artifact.index].data.artifactStepExecutionStatus === ExecutionStatus.done,
    )
  ) {
    return ExecutionStatus.done
  }

  if (
    stepsResultOfArtifactsByStep.some(
      s =>
        s.data.stepExecutionStatus === ExecutionStatus.running &&
        s.data.artifactsResult[artifact.index].data.artifactStepExecutionStatus === ExecutionStatus.running,
    )
  ) {
    return ExecutionStatus.running
  }
  if (stepsResultOfArtifactsByStep.some(s => s.data.stepExecutionStatus === ExecutionStatus.scheduled)) {
    return ExecutionStatus.scheduled
  }

  if (
    stepsResultOfArtifactsByStep.some(
      s =>
        s.data.stepExecutionStatus === ExecutionStatus.aborted &&
        s.data.artifactsResult[artifact.index].data.artifactStepExecutionStatus === ExecutionStatus.aborted,
    )
  ) {
    return ExecutionStatus.aborted
  }
  throw new Error(`we can't be here`)
}

function getStepsResultOfArtifact({
  artifact,
  stepsResultOfArtifactsByStep,
}: {
  artifact: Node<{
    artifact: Artifact
  }>
  stepsResultOfArtifactsByStep: StepsResultOfArtifactsByStep<unknown>
}): StepsResultOfArtifact<unknown> {
  const artifactExecutionStatus = getArtifactExecutionStatus({ artifact, stepsResultOfArtifactsByStep })
  switch (artifactExecutionStatus) {
    case ExecutionStatus.done:
      return {
        artifactExecutionStatus: ExecutionStatus.done,
        artifact: artifact.data.artifact,
        artifactResult: {
          status: calculateCombinedStatus(
            stepsResultOfArtifactsByStep.map(s =>
              s.data.stepExecutionStatus === ExecutionStatus.done
                ? s.data.artifactsResult[artifact.index].data.artifactStepResult.status
                : Status.failed,
            ),
          ),
          notes: _.flatMapDeep(
            stepsResultOfArtifactsByStep.map(s =>
              s.data.stepExecutionStatus === ExecutionStatus.done
                ? s.data.artifactsResult[artifact.index].data.artifactStepResult.notes
                : [],
            ),
          ),
          durationMs: _.sum(
            stepsResultOfArtifactsByStep.map(s =>
              s.data.stepExecutionStatus === ExecutionStatus.done
                ? s.data.artifactsResult[artifact.index].data.artifactStepResult.durationMs
                : 0,
            ),
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
    case ExecutionStatus.running:
    case ExecutionStatus.aborted: {
      return {
        artifactExecutionStatus: artifactExecutionStatus,
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
            case ExecutionStatus.running:
              return {
                ...s,
                data: {
                  stepInfo: s.data.stepInfo,
                  artifactStepExecutionStatus: ExecutionStatus.running,
                },
              }
            case ExecutionStatus.aborted:
              return {
                ...s,
                data: {
                  stepInfo: s.data.stepInfo,
                  artifactStepExecutionStatus: ExecutionStatus.aborted,
                },
              }
            case ExecutionStatus.scheduled:
              return {
                ...s,
                data: {
                  stepInfo: s.data.stepInfo,
                  artifactStepExecutionStatus: ExecutionStatus.scheduled,
                },
              }
          }
        }),
      }
    }
    case ExecutionStatus.scheduled:
      return {
        artifactExecutionStatus: ExecutionStatus.scheduled,
        artifact: artifact.data.artifact,
      }
  }
}

function toStepsResultOfArtifactsByArtifact({
  artifacts,
  stepsResultOfArtifactsByStep,
}: {
  artifacts: Graph<{ artifact: Artifact }>
  stepsResultOfArtifactsByStep: StepsResultOfArtifactsByStep<unknown>
}): StepsResultOfArtifactsByArtifact<unknown> {
  return artifacts.map((a, i) => ({
    ...a,
    data: getStepsResultOfArtifact({ artifact: a, stepsResultOfArtifactsByStep }),
  }))
}

export async function runAllSteps({
  repoPath,
  stepsToRun,
  startFlowMs,
  flowId,
  cache,
  logger,
  artifacts,
  steps,
}: {
  repoPath: string
  steps: Graph<{ stepInfo: StepInfo }>
  stepsToRun: Graph<{ stepInfo: StepInfo; runStep: Step['runStep'] }>
  flowId: string
  startFlowMs: number
  cache: Cache
  logger: Logger
  artifacts: Graph<{ artifact: Artifact }>
}): Promise<StepsResultOfArtifactsByStep<unknown>> {
  const rootPackageJson: PackageJson = await fse.readJson(path.join(repoPath, 'package.json'))

  const stepsResultOfArtifactsByStep: StepsResultOfArtifactsByStep<unknown> = steps.map(s => ({
    ...s,
    data: {
      stepInfo: s.data.stepInfo,
      stepExecutionStatus: ExecutionStatus.scheduled,
    },
  }))
  type State = {
    stepsResultOfArtifactsByStep: StepsResultOfArtifactsByStep<unknown>
    stepsResultOfArtifactsByArtifact: StepsResultOfArtifactsByArtifact<unknown>
  }
  const state: State = {
    stepsResultOfArtifactsByStep,
    stepsResultOfArtifactsByArtifact: toStepsResultOfArtifactsByArtifact({ artifacts, stepsResultOfArtifactsByStep }),
  }

  for (const [i, node] of stepsToRun.entries()) {
    const stepResult = await node.data.runStep({
      artifacts,
      steps,
      cache,
      currentStepInfo: steps[i],
      flowId,
      logger,
      repoPath,
      rootPackageJson,
      startFlowMs,
      stepsResultOfArtifactsByArtifact: state.stepsResultOfArtifactsByArtifact,
      stepsResultOfArtifactsByStep: state.stepsResultOfArtifactsByStep,
    })
    const clone = _.cloneDeep(stepsResultOfArtifactsByStep)
    clone[i].data = stepResult
    state.stepsResultOfArtifactsByStep = clone
    state.stepsResultOfArtifactsByArtifact = toStepsResultOfArtifactsByArtifact({
      artifacts,
      stepsResultOfArtifactsByStep: state.stepsResultOfArtifactsByStep,
    })
  }
  return []
}
