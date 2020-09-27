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
    stepConfigurations,
    stepsResultOfArtifactsByStep,
    stepsResultOfArtifactsByArtifact,
    currentStepInfo,
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
      stepsResultOfArtifactsByStep: normalizeErrors(stepsResultOfArtifactsByStep),
      stepsResultOfArtifactsByArtifact: normalizeErrors(stepsResultOfArtifactsByArtifact),
    }

    const jsonReportTtl = cache.ttls.stepSummary

    await cache.set(
      stepConfigurations.jsonReportCacheKey({ flowId, stepId: currentStepInfo.data.stepInfo.stepId }),
      stepConfigurations.jsonReportToString({ jsonReport }),
      jsonReportTtl,
    )

    return {
      notes: [],
      status: Status.passed,
    }
  },
})
