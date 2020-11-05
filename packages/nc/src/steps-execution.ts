import fse from 'fs-extra'
import _ from 'lodash'
import path from 'path'
import { Logger } from './create-logger'
import {
  Step,
  StepInfo,
  StepResultOfArtifacts,
  StepsResultOfArtifactsByArtifact,
  StepsResultOfArtifactsByStep,
  toStepsResultOfArtifactsByArtifact,
} from './create-step'
import { ImmutableCache } from './immutable-cache'
import { Artifact, ExecutionStatus, Graph, PackageJson } from './types'

type State = {
  stepsResultOfArtifactsByStep: StepsResultOfArtifactsByStep
  stepsResultOfArtifactsByArtifact: StepsResultOfArtifactsByArtifact
}

function updateState({
  stepIndex,
  state,
  stepResultOfArtifacts,
  artifacts,
}: {
  state: State
  stepIndex: number
  stepResultOfArtifacts: StepResultOfArtifacts
  artifacts: Graph<{ artifact: Artifact }>
}) {
  const clone = _.cloneDeep(state.stepsResultOfArtifactsByStep)
  clone[stepIndex].data = stepResultOfArtifacts
  state.stepsResultOfArtifactsByStep = clone
  state.stepsResultOfArtifactsByArtifact = toStepsResultOfArtifactsByArtifact({
    artifacts,
    stepsResultOfArtifactsByStep: state.stepsResultOfArtifactsByStep,
  })
}

export async function runAllSteps({
  repoPath,
  stepsToRun,
  startFlowMs,
  flowId,
  immutableCache,
  logger,
  artifacts,
  steps,
  repoHash,
}: {
  repoPath: string
  steps: Graph<{ stepInfo: StepInfo }>
  stepsToRun: Graph<{ stepInfo: StepInfo; runStep: Step['runStep'] }>
  flowId: string
  repoHash: string
  startFlowMs: number
  immutableCache: ImmutableCache
  logger: Logger
  artifacts: Graph<{ artifact: Artifact }>
}): Promise<State> {
  const rootPackageJson: PackageJson = await fse.readJson(path.join(repoPath, 'package.json'))

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

  const state: State = {
    stepsResultOfArtifactsByStep,
    stepsResultOfArtifactsByArtifact: toStepsResultOfArtifactsByArtifact({ artifacts, stepsResultOfArtifactsByStep }),
  }

  async function runStep(stepIndex: number): Promise<void> {
    switch (stepsResultOfArtifactsByStep[stepIndex].data.stepResult.executionStatus) {
      case ExecutionStatus.done:
        throw new Error(`circual steps graph is not supported (yet?)`)
      case ExecutionStatus.running:
        throw new Error(`circual steps graph is not supported (yet?)`)
      case ExecutionStatus.aborted:
        return
      case ExecutionStatus.scheduled: {
        const onStep = state.stepsResultOfArtifactsByStep[stepIndex].parentsIndexes.every(pIndex =>
          [ExecutionStatus.done, ExecutionStatus.aborted].includes(
            state.stepsResultOfArtifactsByStep[pIndex].data.stepResult.executionStatus,
          ),
        )
        if (onStep) {
          const stepResultOfArtifacts = await stepsToRun[stepIndex].data.runStep({
            artifacts,
            steps,
            immutableCache,
            currentStepInfo: steps[stepIndex],
            flowId,
            logger,
            repoPath,
            repoHash,
            rootPackageJson,
            startFlowMs,
            stepsResultOfArtifactsByArtifact: state.stepsResultOfArtifactsByArtifact,
            stepsResultOfArtifactsByStep: state.stepsResultOfArtifactsByStep,
          })

          updateState({ stepIndex, stepResultOfArtifacts, artifacts, state })

          await Promise.all(steps[stepIndex].childrenIndexes.map(runStep))
        } else {
          // when the last parent-step will be done, we will run this step
          return
        }
      }
    }
  }

  await Promise.all(
    steps
      .filter(s => s.parentsIndexes.length === 0)
      .map(s => s.index)
      .map(runStep),
  )

  return state
}
