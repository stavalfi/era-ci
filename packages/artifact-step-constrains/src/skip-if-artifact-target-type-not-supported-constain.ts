import { createArtifactStepConstrain } from '@tahini/core'
import { ConstrainResult, ExecutionStatus, Status, TargetType, getPackageTargetType } from '@tahini/utils'

export const skipIfArtifactTargetTypeNotSupportedConstrain = createArtifactStepConstrain<{
  supportedTargetType: TargetType
}>({
  constrainName: 'skip-if-artifact-target-type-not-supported-constain',
  constrain: async ({ constrainConfigurations, currentArtifact }) => {
    const targetType = await getPackageTargetType(
      currentArtifact.data.artifact.packagePath,
      currentArtifact.data.artifact.packageJson,
    )

    if (targetType !== constrainConfigurations.supportedTargetType) {
      return {
        constrainResult: ConstrainResult.shouldSkip,
        artifactStepResult: {
          errors: [],
          notes: [],
          executionStatus: ExecutionStatus.aborted,
          status: Status.skippedAsPassed,
        },
      }
    }

    return {
      constrainResult: ConstrainResult.ignoreThisConstrain,
      artifactStepResult: {
        errors: [],
        notes: [],
      },
    }
  },
})
