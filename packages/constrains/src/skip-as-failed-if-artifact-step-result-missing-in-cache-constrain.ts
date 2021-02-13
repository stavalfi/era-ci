import { ConstrainResultType, createConstrain } from '@era-ci/core'
import { Artifact, ExecutionStatus, Node, Status } from '@era-ci/utils'

export const skipAsFailedIfArtifactStepResultMissingInCacheConstrain = createConstrain<{
  stepNameToSearchInCache: string
  skipAsPassedIfStepNotExists?: boolean
  currentArtifact: Node<{ artifact: Artifact }>
}>({
  constrainName: 'skip-as-failed-if-artifact-step-result-missing-in-cache-constrain',
  constrain: async ({
    immutableCache,
    currentStepInfo,
    steps,
    constrainConfigurations: { currentArtifact, stepNameToSearchInCache, skipAsPassedIfStepNotExists = true },
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

    if (actualStepResult) {
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
          executionStatus: ExecutionStatus.aborted,
          status: Status.skippedAsFailed,
          errors: [],
          notes: [
            `artifact-step-result of: "${stepName}" - "${currentArtifact.data.artifact.packageJson.name}" doesn't exists in cache`,
          ],
        },
      }
    }
  },
})
