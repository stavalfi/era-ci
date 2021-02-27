import { ConstrainResultType, createConstrain } from '@era-ci/core'
import { Artifact, ExecutionStatus, Node, Status } from '@era-ci/utils'

export const skipAsPassedIfArtifactStepResultPassedInCacheConstrain = createConstrain<{
  stepNameToSearchInCache: string
  skipAsPassedIfStepNotExists?: boolean
  currentArtifact: Node<{ artifact: Artifact }>
}>({
  constrainName: 'skip-as-passed-if-artifact-step-result-passed-in-cache-constrain',
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

    if (artifactStepResult.passed.length > 0 || artifactStepResult.skippedAsPassed.length > 0) {
      const notes: string[] = []
      if (artifactStepResult.passed.length > 0) {
        const plural = artifactStepResult.passed.length > 1 ? 'flows' : 'flow'
        notes.push(
          `step: "${step.data.stepInfo.displayName}" passed in ${plural}: ${artifactStepResult.passed
            .map(f => (f.flowId === flowId ? 'this-flow' : f.flowId))
            .join(',')}`,
        )
      } else {
        const plural = artifactStepResult.skippedAsPassed.length > 1 ? 'flows' : 'flow'
        notes.push(
          `step: "${step.data.stepInfo.displayName}" passed in ${plural}: ${artifactStepResult.skippedAsPassed
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
