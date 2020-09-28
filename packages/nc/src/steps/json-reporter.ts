import _ from 'lodash'
import { ErrorObject, serializeError } from 'serialize-error'
import traverse from 'traverse'
import {
  createStep,
  ExecutionStatus,
  Result,
  Status,
  StepInfo,
  StepsResultOfArtifactsByArtifact,
  StepsResultOfArtifactsByStep,
  toStepsResultOfArtifactsByArtifact,
} from '../create-step'
import { Artifact, Graph } from '../types'
import { calculateCombinedStatus } from '../utils'

export type JsonReport = {
  flow: {
    flowId: string
    startFlowMs: number
  }
  steps: Graph<{ stepInfo: StepInfo }>
  artifacts: Graph<{ artifact: Artifact }>
  flowResult: Result<ErrorObject>
  stepsResultOfArtifactsByStep: StepsResultOfArtifactsByStep<ErrorObject>
  stepsResultOfArtifactsByArtifact: StepsResultOfArtifactsByArtifact<ErrorObject>
}

export type JsonReportConfiguration = {
  jsonReporterCacheKey: (options: { flowId: string; stepId: string }) => string
  jsonReportToString: (options: { jsonReport: JsonReport }) => string
}

const normalizeErrors = <T>(t: T) =>
  traverse.map(t, function (value: unknown) {
    if (this.key === 'error') {
      return serializeError(value)
    } else {
      return value
    }
  })

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

export const jsonReporterStepName = 'json-reporter'

export const jsonReporter = createStep<JsonReportConfiguration>({
  stepName: jsonReporterStepName,
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

    const jsonReport: JsonReport = {
      artifacts,
      steps: withoutThisStep.steps,
      flow: {
        flowId: flowId,
        startFlowMs,
      },
      flowResult: {
        notes: _.flatMapDeep(
          withoutThisStep.stepsResultOfArtifactsByStep.map(s =>
            s.data.stepExecutionStatus === ExecutionStatus.done ? s.data.stepResult.notes : [],
          ),
        ),
        durationMs: Date.now() - startFlowMs,
        status: calculateCombinedStatus(
          withoutThisStep.stepsResultOfArtifactsByStep.map(s =>
            s.data.stepExecutionStatus === ExecutionStatus.done ? s.data.stepResult.status : Status.passed,
          ),
        ),
      },
      stepsResultOfArtifactsByStep: normalizeErrors(withoutThisStep.stepsResultOfArtifactsByStep),
      stepsResultOfArtifactsByArtifact: normalizeErrors(
        toStepsResultOfArtifactsByArtifact({
          artifacts,
          stepsResultOfArtifactsByStep: withoutThisStep.stepsResultOfArtifactsByStep,
        }),
      ),
    }

    const jsonReportTtl = cache.ttls.stepSummary

    await cache.set(
      stepConfigurations.jsonReporterCacheKey({ flowId, stepId: currentStepInfo.data.stepInfo.stepId }),
      stepConfigurations.jsonReportToString({ jsonReport }),
      jsonReportTtl,
    )

    return {
      notes: [],
      status: Status.passed,
    }
  },
})
