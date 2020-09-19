import { Graph } from '../../types'
import { createStep, StepExecutionStatus, StepStatus } from '../create-step'
import { Artifact, StepNodeData, StepResultOfAllPackages, StepResultOfPackage, StepsSummary } from '../types'
import { calculateCombinedStatus } from '../utils'

const getArtifactResultKey = ({ artifactHash, stepId }: { artifactHash: string; stepId: string }) =>
  `json-report-artifact-result-${artifactHash}---in-step-id-${stepId}`

type ArtifactJsonReport = {
  artifact: Artifact
  stepsResult: Graph<StepNodeData<StepResultOfPackage>>
  stepsSummary: StepsSummary
}

export type JsonReport = {
  flow: {
    flowId: string
    startFlowMs: number
  }
  artifacts: Graph<ArtifactJsonReport>
  steps: Graph<StepNodeData<StepResultOfAllPackages>>
  summary: StepsSummary
}

export type JsonReportConfiguration = {
  jsonReportCacheKey: (options: { flowId: string; stepId: string }) => string
  jsonReportToString: (options: { jsonReport: JsonReport }) => string
}

export const jsonReport = createStep<JsonReportConfiguration>({
  stepName: 'json-report',
  runStepOnArtifact: async ({ currentArtifact, steps, cache, stepId }) => {
    const stepsResult: Graph<StepNodeData<StepResultOfPackage>> = steps.map(stepNode => {
      if (stepNode.data.stepExecutionStatus === StepExecutionStatus.done) {
        const stepResult = stepNode.data.stepResult.artifactsResult.find(
          artifactNode2 =>
            artifactNode2.data.artifact.packageJson.name === currentArtifact.data.artifact.packageJson.name,
        )?.data.stepResult
        if (!stepResult) {
          throw new Error(
            `could not find the step-result: ${stepNode.data.stepInfo.stepName} of artifact ${currentArtifact.data.artifact.packageJson.name} but this step already run on this artifact. it looks like a bug.`,
          )
        }
        return {
          ...stepNode,
          data: {
            stepInfo: stepNode.data.stepInfo,
            stepExecutionStatus: StepExecutionStatus.done,
            stepResult,
          },
        }
      } else {
        return {
          ...stepNode,
          data: {
            stepInfo: stepNode.data.stepInfo,
            stepExecutionStatus: stepNode.data.stepExecutionStatus,
          },
        }
      }
    })

    const stepsSummary: StepsSummary = {
      durationMs: steps.reduce((acc, stepNode) => {
        if (stepNode.data.stepExecutionStatus !== StepExecutionStatus.done) {
          return acc
        }
        const artifactStepResult = stepNode.data.stepResult?.artifactsResult.find(
          a => a.data.artifact.packageJson.name === currentArtifact.data.artifact.packageJson.name,
        )?.data.stepResult
        return acc + (artifactStepResult?.durationMs ?? 0)
      }, 0),
      notes: steps.reduce((acc: string[], stepNode) => {
        if (stepNode.data.stepExecutionStatus !== StepExecutionStatus.done) {
          return acc
        }
        const artifactStepResult = stepNode.data.stepResult?.artifactsResult.find(
          a => a.data.artifact.packageJson.name === currentArtifact.data.artifact.packageJson.name,
        )?.data.stepResult
        return [...acc, ...(artifactStepResult?.notes || [])]
      }, []),
      status: calculateCombinedStatus(
        steps
          .map(stepNode => {
            if (stepNode.data.stepExecutionStatus === StepExecutionStatus.done) {
              const artifactStepResult = stepNode.data.stepResult?.artifactsResult.find(
                a => a.data.artifact.packageJson.name === currentArtifact.data.artifact.packageJson.name,
              )?.data.stepResult

              if (!artifactStepResult) {
                return StepStatus.failed
              } else {
                return artifactStepResult.status
              }
            }
          })
          .filter(Boolean) as StepStatus[],
      ),
    }
    const artifactJsonReport: ArtifactJsonReport = {
      artifact: currentArtifact.data.artifact,
      stepsResult,
      stepsSummary,
    }

    cache.nodeCache.set(
      getArtifactResultKey({ artifactHash: currentArtifact.data.artifact.packageHash, stepId }),
      artifactJsonReport,
    )

    return {
      status: StepStatus.passed,
    }
  },
  onStepDone: async ({ cache, flowId, startFlowMs, steps, allArtifacts, stepId, stepConfigurations }) => {
    let jsonReport: JsonReport
    try {
      const artifacts = allArtifacts.map(artifactNode => {
        const key = getArtifactResultKey({ artifactHash: artifactNode.data.artifact.packageHash, stepId })
        const result = cache.nodeCache.get<ArtifactJsonReport>(key)
        if (!result) {
          throw new Error(`missing key: "${key}" in node-cache. can't create json-report.`)
        }
        return {
          ...artifactNode,
          data: result,
        }
      })
      jsonReport = {
        flow: {
          flowId,
          startFlowMs,
        },
        steps,
        artifacts,
        summary: {
          durationMs: Date.now() - startFlowMs,
          notes: steps.reduce(
            (acc: string[], stepNode) =>
              stepNode.data.stepExecutionStatus === StepExecutionStatus.done
                ? [...acc, ...stepNode.data.stepResult.stepSummary.notes]
                : acc,
            [],
          ),
          status: calculateCombinedStatus(
            steps
              .map(stepNode => {
                if (stepNode.data.stepExecutionStatus === StepExecutionStatus.done) {
                  return stepNode.data.stepResult.stepSummary.status
                }
              })
              .filter(Boolean) as StepStatus[],
          ),
        },
      }
    } catch (error) {
      jsonReport = {
        flow: {
          flowId,
          startFlowMs,
        },
        steps: [],
        artifacts: [],
        summary: {
          durationMs: Date.now() - startFlowMs,
          notes: [],
          status: StepStatus.failed,
          error,
        },
      }
    }

    const jsonReportTtl = cache.ttls.stepResult

    await cache.set(
      stepConfigurations.jsonReportCacheKey({ flowId, stepId }),
      stepConfigurations.jsonReportToString({ jsonReport }),
      jsonReportTtl,
    )
  },
})
