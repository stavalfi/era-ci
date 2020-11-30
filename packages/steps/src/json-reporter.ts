import {
  AbortStepResultOfArtifacts,
  AbortStepsResultOfArtifact,
  createStep,
  DoneStepResultOfArtifacts,
  DoneStepsResultOfArtifact,
  LocalSequentalTaskQueue,
  RunStrategy,
  ScheduledStepResultOfArtifacts,
  ScheduledStepsResultOfArtifact,
  StepInfo,
  StepResultOfArtifacts,
  StepsResultOfArtifact,
  toStepsResultOfArtifactsByArtifact,
} from '@tahini/core'
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
} from '@tahini/utils'
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
      stepsResultOfArtifactsByStep: Graph<DoneStepResultOfArtifacts>
      stepsResultOfArtifactsByArtifact: Graph<DoneStepsResultOfArtifact>
    }
  | {
      flowExecutionStatus: ExecutionStatus.aborted // this property is not needed but it is a workaround for: https://github.com/microsoft/TypeScript/issues/7294
      flowResult: AbortResult<Status>
      stepsResultOfArtifactsByStep: Graph<DoneStepResultOfArtifacts | AbortStepResultOfArtifacts>
      stepsResultOfArtifactsByArtifact: Graph<DoneStepsResultOfArtifact | AbortStepsResultOfArtifact>
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
  stepsResultOfArtifactsByArtifact,
  stepsResultOfArtifactsByStep,
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
  stepsResultOfArtifactsByStep: Graph<StepResultOfArtifacts>
  stepsResultOfArtifactsByArtifact: Graph<StepsResultOfArtifact>
}): JsonReport {
  const flowExecutionStatus = calculateExecutionStatus(
    stepsResultOfArtifactsByStep.map(s => s.data.stepResult.executionStatus),
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
            stepsResultOfArtifactsByStep.map(s => {
              if (s.data.stepResult.executionStatus !== ExecutionStatus.done) {
                throw new Error(`we can't be here`)
              }
              return s.data.stepResult.notes.map(n => `${s.data.stepInfo.displayName} - ${n}`)
            }),
          ),
          durationMs: Date.now() - startFlowMs,
          status: calculateCombinedStatus(
            stepsResultOfArtifactsByStep.map(s => {
              if (s.data.stepResult.executionStatus !== ExecutionStatus.done) {
                throw new Error(`we can't be here`)
              }
              return s.data.stepResult.status
            }),
          ),
        },
        stepsResultOfArtifactsByStep: stepsResultOfArtifactsByStep as Graph<DoneStepResultOfArtifacts>,
        stepsResultOfArtifactsByArtifact: stepsResultOfArtifactsByArtifact as Graph<DoneStepsResultOfArtifact>,
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
            stepsResultOfArtifactsByStep.map(s => {
              if (
                s.data.stepResult.executionStatus !== ExecutionStatus.done &&
                s.data.stepResult.executionStatus !== ExecutionStatus.aborted
              ) {
                throw new Error(`we can't be here`)
              }
              return s.data.stepResult.notes.map(n => `${s.data.stepInfo.displayName} - ${n}`)
            }),
          ),
          durationMs: Date.now() - startFlowMs,
          status: calculateCombinedStatus(
            stepsResultOfArtifactsByStep.map(s => {
              if (
                s.data.stepResult.executionStatus !== ExecutionStatus.done &&
                s.data.stepResult.executionStatus !== ExecutionStatus.aborted
              ) {
                throw new Error(`we can't be here`)
              }
              return s.data.stepResult.status
            }),
          ),
        },
        stepsResultOfArtifactsByStep: stepsResultOfArtifactsByStep as Graph<
          DoneStepResultOfArtifacts | AbortStepResultOfArtifacts
        >,
        stepsResultOfArtifactsByArtifact: stepsResultOfArtifactsByArtifact as Graph<
          DoneStepsResultOfArtifact | AbortStepsResultOfArtifact
        >,
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
        stepsResultOfArtifactsByStep: stepsResultOfArtifactsByStep as Graph<StepResultOfArtifacts>,
        stepsResultOfArtifactsByArtifact: stepsResultOfArtifactsByArtifact as Graph<StepsResultOfArtifact>,
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
        stepsResultOfArtifactsByStep: stepsResultOfArtifactsByStep as Graph<ScheduledStepResultOfArtifacts>,
        stepsResultOfArtifactsByArtifact: stepsResultOfArtifactsByArtifact as Graph<ScheduledStepsResultOfArtifact>,
      }
  }
}

export const jsonReporterStepName = 'json-reporter'

export const jsonReporter = createStep({
  stepName: jsonReporterStepName,
  taskQueueClass: LocalSequentalTaskQueue,
  run: {
    runStrategy: RunStrategy.root,
    runStepOnRoot: async ({
      immutableCache,
      flowId,
      repoHash,
      startFlowMs,
      steps,
      artifacts,
      stepsResultOfArtifactsByStep,
      currentStepInfo,
    }) => {
      const withoutThisStep = {
        steps: removeNodeFromGraph({ graph: steps, nodeIndexToRemove: currentStepInfo.index }),
        stepsResultOfArtifactsByStep: removeNodeFromGraph({
          graph: stepsResultOfArtifactsByStep,
          nodeIndexToRemove: currentStepInfo.index,
        }),
      }
      const jsonReport = getJsonReport({
        startFlowMs,
        artifacts,
        flowId,
        repoHash,
        steps: withoutThisStep.steps,
        stepsResultOfArtifactsByStep: withoutThisStep.stepsResultOfArtifactsByStep,
        stepsResultOfArtifactsByArtifact: toStepsResultOfArtifactsByArtifact({
          artifacts,
          stepsResultOfArtifactsByStep: withoutThisStep.stepsResultOfArtifactsByStep,
        }),
      })

      const jsonReportTtl = immutableCache.ttls.ArtifactStepResult

      await immutableCache.set({
        key: jsonReporterCacheKey({ flowId, stepId: currentStepInfo.data.stepInfo.stepId }),
        value: jsonReportToString({ jsonReport }),
        ttl: jsonReportTtl,
      })

      return { errors: [], notes: [], executionStatus: ExecutionStatus.done, status: Status.passed }
    },
  },
})
