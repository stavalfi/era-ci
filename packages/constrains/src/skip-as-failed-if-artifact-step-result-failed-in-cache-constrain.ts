import { ConstrainResultType, createConstrain } from '@era-ci/core'
import { Artifact, ExecutionStatus, Node, Status } from '@era-ci/utils'

export const skipAsFailedIfArtifactStepResultFailedInCacheConstrain = createConstrain<{
  stepNameToSearchInCache: string
  skipAsPassedIfStepNotExists?: boolean
  currentArtifact: Node<{ artifact: Artifact }>
}>({
  constrainName: 'skip-as-failed-if-artifact-step-result-failed-in-cache-constrain',
  constrain: async ({
    immutableCache,
    currentStepInfo,
    steps,
    flowId,
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

    const artifactStepResult = await immutableCache.step.getArtifactStepResults({
      stepId: step.data.stepInfo.stepId,
      artifactHash: currentArtifact.data.artifact.packageHash,
    })

    if (artifactStepResult.all.length === 0) {
      return {
        resultType: ConstrainResultType.ignoreThisConstrain,
        result: {
          errors: [],
          notes: [
            `artifact-step-result of: "${stepName}" - "${currentArtifact.data.artifact.packageJson.name}" doesn't exists in cache`,
          ],
        },
      }
    }

    if (artifactStepResult.failed.length > 0 || artifactStepResult.skippedAsFailed.length > 0) {
      const notes: string[] = []
      if (artifactStepResult.failed.length > 0) {
        const plural = artifactStepResult.failed.length > 1 ? 'flows' : 'flow'

        notes.push(
          `step: "${step.data.stepInfo.displayName}" ${plural} in flows: ${artifactStepResult.failed
            .map(f => (f.flowId === flowId ? 'this-flow' : f.flowId))
            .join(',')}`,
        )
      } else {
        const plural = artifactStepResult.skippedAsFailed.length > 1 ? 'flows' : 'flow'

        notes.push(
          `step: "${step.data.stepInfo.displayName}" ${plural} in flows: ${artifactStepResult.skippedAsFailed
            .map(f => (f.flowId === flowId ? 'this-flow' : f.flowId))
            .join(',')}`,
        )
      }

      return {
        resultType: ConstrainResultType.shouldSkip,
        result: {
          errors: [],
          notes,
          executionStatus: ExecutionStatus.aborted,
          status: Status.skippedAsFailed,
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
