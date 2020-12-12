import { ConstrainResultType, createConstrain } from '@tahini/core'
import { ExecutionStatus, Status, TargetType, getPackageTargetType, Artifact, Node } from '@tahini/utils'

export const skipIfArtifactTargetTypeNotSupportedConstrain = createConstrain<{
  supportedTargetType: TargetType
  currentArtifact: Node<{ artifact: Artifact }>
}>({
  constrainName: 'skip-if-artifact-target-type-not-supported-constain',
  constrain: async ({ constrainConfigurations: { currentArtifact, supportedTargetType } }) => {
    const targetType = await getPackageTargetType(
      currentArtifact.data.artifact.packagePath,
      currentArtifact.data.artifact.packageJson,
    )

    if (targetType !== supportedTargetType) {
      return {
        constrainResultType: ConstrainResultType.shouldSkip,
        result: {
          errors: [],
          notes: [],
          executionStatus: ExecutionStatus.aborted,
          status: Status.skippedAsPassed,
        },
      }
    }

    return {
      constrainResultType: ConstrainResultType.ignoreThisConstrain,
      result: {
        errors: [],
        notes: [],
      },
    }
  },
})
