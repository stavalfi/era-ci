import { ConstrainResultType, createConstrain } from '@era-ci/core'
import { ExecutionStatus, Status, TargetType, getPackageTargetTypes, Artifact, Node } from '@era-ci/utils'

export const skipAsPassedIfArtifactTargetTypeNotSupportedConstrain = createConstrain<{
  supportedTargetType: TargetType
  currentArtifact: Node<{ artifact: Artifact }>
}>({
  constrainName: 'skip-as-passed-if-artifact-target-type-not-supported-constain',
  constrain: async ({ constrainConfigurations: { currentArtifact, supportedTargetType } }) => {
    const targetTypes = await getPackageTargetTypes(
      currentArtifact.data.artifact.packagePath,
      currentArtifact.data.artifact.packageJson,
    )

    if (!targetTypes.includes(supportedTargetType)) {
      return {
        resultType: ConstrainResultType.shouldSkip,
        result: {
          errors: [],
          notes: [],
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
