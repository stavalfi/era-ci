import { ConstrainResultType, createConstrain } from '@era-ci/core'
import { Artifact, ExecutionStatus, Node, Status } from '@era-ci/utils'

export const skipAsPassedIfArtifactNotDeployableConstrain = createConstrain<{
  currentArtifact: Node<{ artifact: Artifact }>
}>({
  constrainName: 'skip-as-passed-if-artifact-not-deployable-constain',
  constrain: async ({ constrainConfigurations: { currentArtifact } }) => {
    if (!currentArtifact.data.artifact.packageJson.deployable) {
      return {
        resultType: ConstrainResultType.shouldSkip,
        result: {
          errors: [],
          notes: [`skipping because it's not a deployable artifact`],
          executionStatus: ExecutionStatus.aborted,
          status: Status.skippedAsPassed,
        },
      }
    }

    return {
      resultType: ConstrainResultType.ignoreThisConstrain,
      result: {
        errors: [],
        notes: [],
      },
    }
  },
})
