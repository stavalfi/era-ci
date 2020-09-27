import {
  createStep,
  ExecutionStatus,
  Result,
  Status,
  StepInfo,
  StepResultOfArtifacts,
  StepsResultOfArtifact,
  StepsResultOfArtifactsByArtifact,
  StepsResultOfArtifactsByStep,
} from '../create-step'
import { Artifact, Graph } from '../types'
import { calculateCombinedStatus } from '../utils'
import { serializeError, ErrorObject } from 'serialize-error'
import _ from 'lodash'
import traverse from 'traverse'

export type JsonReport = {
  flow: {
    flowId: string
    startFlowMs: number
  }
  steps: Graph<{ stepInfo: StepInfo }>
  artifacts: Graph<{ artifact: Artifact }>
  flowResult: Result<ErrorObject>
  stepResultOfArtifacts: StepResultOfArtifacts<ErrorObject>
  stepsResultOfArtifactsByStep: StepsResultOfArtifactsByStep<ErrorObject>
  stepsResultOfArtifact: StepsResultOfArtifact<ErrorObject>
  stepsResultOfArtifactsByArtifact: StepsResultOfArtifactsByArtifact<ErrorObject>
}

export type JsonReportConfiguration = {
  jsonReportCacheKey: (options: { flowId: string; stepId: string }) => string
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

export const jsonReport = createStep<JsonReportConfiguration>({
  stepName: 'json-report',
  runStepOnRoot: async ({
    cache,
    flowId,
    startFlowMs,
    steps,
    artifacts,
    stepId,
    stepConfigurations,
    stepResultOfArtifacts,
    stepsResultOfArtifact,
    stepsResultOfArtifactsByStep,
    stepsResultOfArtifactsByArtifact,
  }) => {
    const jsonReport: JsonReport = {
      artifacts,
      steps,
      flow: {
        flowId: flowId,
        startFlowMs,
      },
      flowResult: {
        notes: _.flatMapDeep(
          stepsResultOfArtifactsByStep.map(s =>
            s.data.stepExecutionStatus === ExecutionStatus.done ? s.data.stepResult.notes : [],
          ),
        ),
        durationMs: Date.now() - startFlowMs,
        status: calculateCombinedStatus(
          stepsResultOfArtifactsByStep.map(s =>
            s.data.stepExecutionStatus === ExecutionStatus.done ? s.data.stepResult.status : Status.passed,
          ),
        ),
      },
      stepResultOfArtifacts: normalizeErrors(stepResultOfArtifacts),
      stepsResultOfArtifactsByStep: normalizeErrors(stepsResultOfArtifactsByStep),
      stepsResultOfArtifact: normalizeErrors(stepsResultOfArtifact),
      stepsResultOfArtifactsByArtifact: normalizeErrors(stepsResultOfArtifactsByArtifact),
    }

    const jsonReportTtl = cache.ttls.stepSummary

    await cache.set(
      stepConfigurations.jsonReportCacheKey({ flowId, stepId }),
      stepConfigurations.jsonReportToString({ jsonReport }),
      jsonReportTtl,
    )

    return {
      notes: [],
      status: Status.passed,
    }
  },
})
