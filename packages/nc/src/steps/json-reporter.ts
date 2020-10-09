import _ from 'lodash'
import {
  AbortResult,
  AbortStepResultOfArtifacts,
  AbortStepsResultOfArtifact,
  createStep,
  DoneResult,
  DoneStepResultOfArtifacts,
  DoneStepsResultOfArtifact,
  ExecutionStatus,
  RunningResult,
  ScheduledResult,
  ScheduledStepResultOfArtifacts,
  ScheduledStepsResultOfArtifact,
  Status,
  StepInfo,
  StepResultOfArtifacts,
  StepsResultOfArtifact,
  toStepsResultOfArtifactsByArtifact,
} from '../create-step'
import { Artifact, Graph } from '../types'
import { calculateCombinedStatus, calculateExecutionStatus } from '../utils'

export type JsonReport = {
  flow: {
    flowId: string
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

export type JsonReportConfiguration = {
  jsonReporterCacheKey: (options: { flowId: string; stepId: string }) => string
  jsonReportToString: (options: { jsonReport: JsonReport }) => string
}

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
  artifacts,
}: {
  steps: Graph<{
    stepInfo: StepInfo
  }>
  artifacts: Graph<{
    artifact: Artifact
  }>
  flowId: string
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
          flowId: flowId,
          startFlowMs,
        },
        flowExecutionStatus: ExecutionStatus.done,
        flowResult: {
          executionStatus: ExecutionStatus.done,
          notes: _.flatMapDeep(
            stepsResultOfArtifactsByStep.map(s => {
              if (s.data.stepResult.executionStatus !== ExecutionStatus.done) {
                throw new Error(`we can't be here`)
              }
              return s.data.stepResult.notes
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
          flowId: flowId,
          startFlowMs,
        },
        flowExecutionStatus: ExecutionStatus.aborted,
        flowResult: {
          executionStatus: ExecutionStatus.aborted,
          notes: _.flatMapDeep(
            stepsResultOfArtifactsByStep.map(s => {
              if (
                s.data.stepResult.executionStatus !== ExecutionStatus.done &&
                s.data.stepResult.executionStatus !== ExecutionStatus.aborted
              ) {
                throw new Error(`we can't be here`)
              }
              return s.data.stepResult.notes
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
          flowId: flowId,
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
          flowId: flowId,
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

export const jsonReporter = createStep<JsonReportConfiguration>({
  stepName: jsonReporterStepName,
  canRunStepOnArtifact: {
    options: {
      runIfSomeDirectParentStepFailedOnPackage: true,
    },
  },
  runStepOnRoot: async ({
    cache,
    flowId,
    startFlowMs,
    steps,
    artifacts,
    stepConfigurations,
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
      steps: withoutThisStep.steps,
      stepsResultOfArtifactsByStep: withoutThisStep.stepsResultOfArtifactsByStep,
      stepsResultOfArtifactsByArtifact: toStepsResultOfArtifactsByArtifact({
        artifacts,
        stepsResultOfArtifactsByStep: withoutThisStep.stepsResultOfArtifactsByStep,
      }),
    })

    const jsonReportTtl = cache.ttls.stepSummary

    await cache.set({
      key: stepConfigurations.jsonReporterCacheKey({ flowId, stepId: currentStepInfo.data.stepInfo.stepId }),
      value: stepConfigurations.jsonReportToString({ jsonReport }),
      ttl: jsonReportTtl,
      allowOverride: false,
    })

    return {
      notes: [],
      executionStatus: ExecutionStatus.done,
      status: Status.passed,
    }
  },
})
