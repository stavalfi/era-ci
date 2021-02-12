import { ConstrainResultType, createConstrain } from '@era-ci/core'
import { Artifact, didPassOrSkippedAsPassed, ExecutionStatus, Node, Status } from '@era-ci/utils'

export const skipIfArtifactStepResultPassedInCacheConstrain = createConstrain<{
  stepNameToSearchInCache: string
  skipAsPassedIfStepNotExists?: boolean
  currentArtifact: Node<{ artifact: Artifact }>
}>({
  constrainName: 'skip-if-artifact-step-result-passed-in-cache-constrain',
  constrain: async ({
    immutableCache,
    currentStepInfo,
    steps,
    flowId,
    constrainConfigurations: { currentArtifact, skipAsPassedIfStepNotExists = true, stepNameToSearchInCache },
  }) => {
    const stepName = stepNameToSearchInCache
    const step = steps.find(step => step.data.stepInfo.stepName === stepName)

    if (!step) {
      if (skipAsPassedIfStepNotExists) {
        return {
          resultType: ConstrainResultType.ignoreThisConstrain,
          result: {
            errors: [],
            notes: [],
          },
        }
      } else {
        return {
          resultType: ConstrainResultType.shouldSkip,
          result: {
            errors: [],
            executionStatus: ExecutionStatus.aborted,
            status: Status.skippedAsFailed,
            notes: [
              `step: "${stepName}" doesn't exists in this flow and is required step: "${currentStepInfo.data.stepInfo.displayName}"`,
            ],
          },
        }
      }
    }

    const actualStepResult = await immutableCache.step.getArtifactStepResult({
      stepId: step.data.stepInfo.stepId,
      artifactHash: currentArtifact.data.artifact.packageHash,
    })

    if (!actualStepResult) {
      return {
        resultType: ConstrainResultType.shouldSkip,
        result: {
          executionStatus: ExecutionStatus.aborted,
          status: Status.skippedAsFailed,
          errors: [],
          notes: [`step result of: "${stepName}" doesn't exists in cache`],
        },
      }
    }

    if (didPassOrSkippedAsPassed(actualStepResult.artifactStepResult.status)) {
      const isResultFromThisFlow = flowId === actualStepResult.flowId
      const isThisStep = currentStepInfo.data.stepInfo.stepId === step.data.stepInfo.stepId
      const notes: string[] = []
      if (isResultFromThisFlow && isThisStep) {
        // we are running the ci again and nothing was changed in the repo
        notes.push(`step already passed`)
      }
      if (isResultFromThisFlow && !isThisStep) {
        notes.push(`step: "${step.data.stepInfo.displayName}" passed`)
      }
      if (!isResultFromThisFlow && isThisStep) {
        notes.push(`step already passed in flow: "${actualStepResult.flowId}"`)
      }
      if (!isResultFromThisFlow && !isThisStep) {
        notes.push(`step: "${step.data.stepInfo.displayName}" passed in flow: "${actualStepResult.flowId}"`)
      }
      return {
        resultType: ConstrainResultType.shouldSkip,
        result: {
          errors: [],
          notes,
          executionStatus: ExecutionStatus.aborted,
          status: Status.skippedAsPassed,
        },
      }
    } else {
      return {
        resultType: ConstrainResultType.ignoreThisConstrain,
        result: {
          errors: [],
          notes: [],
        },
      }
    }
  },
})
