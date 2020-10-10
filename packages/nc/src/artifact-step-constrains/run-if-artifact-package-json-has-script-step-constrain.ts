import { createArtifactStepConstrain } from '../create-artifact-step-constrain'
import { ConstrainResult, ExecutionStatus, Status } from '../types'

export const runIfArtifactPackageJsonHasScriptConstrain = createArtifactStepConstrain<{ scriptName: string }>({
  constrainName: 'run-if-artifact-package-json-has-script-step-constrain',
  constrain: async ({ constrainConfigurations, currentArtifact }) => {
    const scriptName = constrainConfigurations.scriptName
    if (
      currentArtifact.data.artifact.packageJson.scripts &&
      scriptName in currentArtifact.data.artifact.packageJson.scripts &&
      currentArtifact.data.artifact.packageJson.scripts[scriptName]
    ) {
      return {
        constrainResult: ConstrainResult.shouldRun,
        artifactStepResult: {
          errors: [],
          notes: [],
        },
      }
    } else {
      return {
        constrainResult: ConstrainResult.shouldSkip,
        artifactStepResult: {
          errors: [],
          executionStatus: ExecutionStatus.aborted,
          status: Status.skippedAsPassed,
          notes: [`skipping because missing ${scriptName}-script in artifact package.json`],
        },
      }
    }
  },
})
