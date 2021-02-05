import {
  AbortStepResultOfArtifacts,
  AbortStepsResultOfArtifact,
  createStep,
  DoneStepResultOfArtifacts,
  DoneStepsResultOfArtifact,
  ScheduledStepResultOfArtifacts,
  ScheduledStepsResultOfArtifact,
  State,
  StepResultOfArtifacts,
  StepsResultOfArtifact,
  toStepsResultOfArtifactsByArtifact,
} from '@era-ci/core'
import { LocalSequentalTaskQueue } from '@era-ci/task-queues'
import {
  AbortResult,
  Artifact,
  calculateCombinedStatus,
  calculateExecutionStatus,
  DoneResult,
  ExecutionStatus,
  Graph,
  RunningResult,
  ScheduledResult,
  Status,
  StepInfo,
} from '@era-ci/utils'
import _ from 'lodash'

export type JsonReport = {
  flow: {
    flowId: string
    repoHash: string
    startFlowMs: number
  }
  steps: Graph<{ stepInfo: StepInfo }>
  artifacts: Graph<{ artifact: Artifact }>
} & (
  | {
      flowExecutionStatus: ExecutionStatus.done // this property is not needed but it is a workaround for: https://github.com/microsoft/TypeScript/issues/7294
      flowResult: DoneResult
      stepsResultOfArtifactsByStep: Graph<DoneStepResultOfArtifacts | AbortStepResultOfArtifacts>
      stepsResultOfArtifactsByArtifact: Graph<DoneStepsResultOfArtifact | AbortStepsResultOfArtifact>
    }
  | {
      flowExecutionStatus: ExecutionStatus.aborted // this property is not needed but it is a workaround for: https://github.com/microsoft/TypeScript/issues/7294
      flowResult: AbortResult<Status>
      stepsResultOfArtifactsByStep: Graph<AbortStepResultOfArtifacts>
      stepsResultOfArtifactsByArtifact: Graph<AbortStepsResultOfArtifact>
    }
  | {
      flowExecutionStatus: ExecutionStatus.running // this property is not needed but it is a workaround for: https://github.com/microsoft/TypeScript/issues/7294
      flowResult: RunningResult
      stepsResultOfArtifactsByStep: Graph<StepResultOfArtifacts>
      stepsResultOfArtifactsByArtifact: Graph<StepsResultOfArtifact>
    }
  | {
      flowExecutionStatus: ExecutionStatus.scheduled // this property is not needed but it is a workaround for: https://github.com/microsoft/TypeScript/issues/7294
      flowResult: ScheduledResult
      stepsResultOfArtifactsByStep: Graph<ScheduledStepResultOfArtifacts>
      stepsResultOfArtifactsByArtifact: Graph<ScheduledStepsResultOfArtifact>
    }
)

export const jsonReporterCacheKey = ({ flowId, stepId }: { flowId: string; stepId: string }): string =>
  `json-report-cache-key-${flowId}-${stepId}`

export const jsonReportToString = ({ jsonReport }: { jsonReport: JsonReport }): string => JSON.stringify(jsonReport)

export const stringToJsonReport = ({ jsonReportAsString }: { jsonReportAsString: string }): JsonReport =>
  JSON.parse(jsonReportAsString)

function removeNodeFromGraph<T>({
  graph,
  nodeIndexToRemove,
}: {
  graph: Graph<T>
  nodeIndexToRemove: number
}): Graph<T> {
  const graphWithoutNode: Graph<T> = graph.map(n => ({
    index: n.index,
    childrenIndexes: n.childrenIndexes.filter(i => i !== nodeIndexToRemove),
    parentsIndexes: n.parentsIndexes.filter(i => i !== nodeIndexToRemove),
    data: n.data,
  }))

  const minimizedGraphTemp: Graph<T> = []

  function fill(stepIndex: number) {
    if (minimizedGraphTemp.some(n => n.index === stepIndex)) {
      return
    }
    minimizedGraphTemp.push(graphWithoutNode[stepIndex])
    for (const child of graphWithoutNode[stepIndex].childrenIndexes) {
      fill(child)
    }
  }

  const heads = graph.filter(n => n.parentsIndexes.length === 0).filter(s => s.index !== nodeIndexToRemove)
  for (const head of heads) {
    fill(head.index)
  }

  // fix indexes of all nodes in the new (minimized) graph
  function normalizeGraph(graph: Graph<T>): Graph<T> {
    const oldIndexToNewIndex = Object.fromEntries(graph.map((n, i) => [n.index, i]))

    return graph.map(n => ({
      index: oldIndexToNewIndex[n.index],
      childrenIndexes: n.childrenIndexes.map(i => oldIndexToNewIndex[i]),
      parentsIndexes: n.parentsIndexes.map(i => oldIndexToNewIndex[i]),
      data: n.data,
    }))
  }

  const result = normalizeGraph(minimizedGraphTemp)

  return result
}

function getJsonReport({
  flowId,
  state,
  startFlowMs,
  steps,
  repoHash,
  artifacts,
}: {
  steps: Graph<{
    stepInfo: StepInfo
  }>
  artifacts: Graph<{
    artifact: Artifact
  }>
  flowId: string
  repoHash: string
  startFlowMs: number
  state: Omit<State, 'flowFinished'>
}): JsonReport {
  const flowExecutionStatus = calculateExecutionStatus(
    state.stepsResultOfArtifactsByStep.map(s => s.data.stepResult.executionStatus),
  )

  switch (flowExecutionStatus) {
    case ExecutionStatus.done:
      return {
        artifacts,
        steps,
        flow: {
          flowId,
          repoHash,
          startFlowMs,
        },
        flowExecutionStatus: ExecutionStatus.done,
        flowResult: {
          errors: [],
          executionStatus: ExecutionStatus.done,
          notes: _.flatMapDeep(
            state.stepsResultOfArtifactsByStep.map(s => {
              if (
                s.data.stepResult.executionStatus !== ExecutionStatus.done &&
                s.data.stepResult.executionStatus !== ExecutionStatus.aborted
              ) {
                throw new Error(`we can't be here12`)
              }
              return s.data.stepResult.notes.map(n => `${s.data.stepInfo.displayName} - ${n}`)
            }),
          ),
          durationMs: _.sum(
            state.stepsResultOfArtifactsByStep.map(s => {
              if (
                s.data.stepResult.executionStatus !== ExecutionStatus.done &&
                s.data.stepResult.executionStatus !== ExecutionStatus.aborted
              ) {
                throw new Error(`we can't be here12`)
              }
              return s.data.stepResult.durationMs
            }),
          ),
          status: calculateCombinedStatus(
            state.stepsResultOfArtifactsByStep.map(s => {
              if (
                s.data.stepResult.executionStatus !== ExecutionStatus.done &&
                s.data.stepResult.executionStatus !== ExecutionStatus.aborted
              ) {
                throw new Error(`we can't be here13`)
              }
              return s.data.stepResult.status
            }),
          ) as Status.passed | Status.failed,
        },
        stepsResultOfArtifactsByStep: state.stepsResultOfArtifactsByStep as Graph<
          DoneStepResultOfArtifacts | AbortStepResultOfArtifacts
        >,
        stepsResultOfArtifactsByArtifact: state.stepsResultOfArtifactsByArtifact as Graph<
          DoneStepsResultOfArtifact | AbortStepsResultOfArtifact
        >,
      }
    case ExecutionStatus.aborted:
      return {
        artifacts,
        steps,
        flow: {
          flowId,
          repoHash,
          startFlowMs,
        },
        flowExecutionStatus: ExecutionStatus.aborted,
        flowResult: {
          errors: [],
          executionStatus: ExecutionStatus.aborted,
          notes: _.flatMapDeep(
            state.stepsResultOfArtifactsByStep.map(s => {
              if (s.data.stepResult.executionStatus !== ExecutionStatus.aborted) {
                throw new Error(`we can't be here14`)
              }
              return s.data.stepResult.notes.map(n => `${s.data.stepInfo.displayName} - ${n}`)
            }),
          ),
          durationMs: _.sum(
            state.stepsResultOfArtifactsByStep.map(s => {
              if (
                s.data.stepResult.executionStatus !== ExecutionStatus.done &&
                s.data.stepResult.executionStatus !== ExecutionStatus.aborted
              ) {
                throw new Error(`we can't be here12`)
              }
              return s.data.stepResult.durationMs
            }),
          ),
          status: calculateCombinedStatus(
            state.stepsResultOfArtifactsByStep.map(s => {
              if (s.data.stepResult.executionStatus !== ExecutionStatus.aborted) {
                throw new Error(`we can't be here15`)
              }
              return s.data.stepResult.status
            }),
          ) as Status.skippedAsPassed | Status.skippedAsFailed | Status.failed,
        },
        stepsResultOfArtifactsByStep: state.stepsResultOfArtifactsByStep as Graph<AbortStepResultOfArtifacts>,
        stepsResultOfArtifactsByArtifact: state.stepsResultOfArtifactsByArtifact as Graph<AbortStepsResultOfArtifact>,
      }
    case ExecutionStatus.running:
      return {
        artifacts,
        steps,
        flow: {
          flowId,
          repoHash,
          startFlowMs,
        },
        flowExecutionStatus: ExecutionStatus.running,
        flowResult: {
          executionStatus: ExecutionStatus.running,
        },
        stepsResultOfArtifactsByStep: state.stepsResultOfArtifactsByStep as Graph<StepResultOfArtifacts>,
        stepsResultOfArtifactsByArtifact: state.stepsResultOfArtifactsByArtifact as Graph<StepsResultOfArtifact>,
      }
    case ExecutionStatus.scheduled:
      return {
        artifacts,
        steps,
        flow: {
          flowId,
          repoHash,
          startFlowMs,
        },
        flowExecutionStatus: ExecutionStatus.scheduled,
        flowResult: {
          executionStatus: ExecutionStatus.scheduled,
        },
        stepsResultOfArtifactsByStep: state.stepsResultOfArtifactsByStep as Graph<ScheduledStepResultOfArtifacts>,
        stepsResultOfArtifactsByArtifact: state.stepsResultOfArtifactsByArtifact as Graph<
          ScheduledStepsResultOfArtifact
        >,
      }
  }
}

export const jsonReporterStepName = 'json-reporter'

export const jsonReporter = createStep({
  stepName: jsonReporterStepName,
  stepGroup: 'json-reporter',
  taskQueueClass: LocalSequentalTaskQueue,
  run: async ({ immutableCache, flowId, repoHash, startFlowMs, steps, artifacts, getState, currentStepInfo }) => ({
    stepLogic: async () => {
      const withoutThisStep = {
        steps: removeNodeFromGraph({ graph: steps, nodeIndexToRemove: currentStepInfo.index }),
        stepsResultOfArtifactsByStep: removeNodeFromGraph({
          graph: getState().stepsResultOfArtifactsByStep,
          nodeIndexToRemove: currentStepInfo.index,
        }),
      }

      const jsonReport = getJsonReport({
        startFlowMs,
        artifacts,
        flowId,
        repoHash,
        steps: withoutThisStep.steps,
        state: {
          stepsResultOfArtifactsByStep: withoutThisStep.stepsResultOfArtifactsByStep,
          stepsResultOfArtifactsByArtifact: toStepsResultOfArtifactsByArtifact({
            artifacts,
            stepsResultOfArtifactsByStep: withoutThisStep.stepsResultOfArtifactsByStep,
          }),
        },
      })

      const jsonReportTtl = immutableCache.ttls.ArtifactStepResult
      await immutableCache.set({
        key: jsonReporterCacheKey({ flowId, stepId: currentStepInfo.data.stepInfo.stepId }),
        value: jsonReportToString({ jsonReport }),
        asBuffer: true,
        ttl: jsonReportTtl,
      })
    },
  }),
})
