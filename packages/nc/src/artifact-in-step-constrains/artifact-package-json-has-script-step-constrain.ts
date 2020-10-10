import { createArtifactInStepConstrain } from '../create-artifact-in-step-constrain'
import { ExecutionStatus, Status } from '../types'

export const artifactPackageJsonHasScriptConstrain = createArtifactInStepConstrain<{ scriptName: string }>({
  constrainName: 'artifact-package-json-has-script-step-constrain',
  constrain: async ({ constrainConfigurations, currentArtifact }) => {
    const scriptName = constrainConfigurations.scriptName
    if (
      currentArtifact.data.artifact.packageJson.scripts &&
      scriptName in currentArtifact.data.artifact.packageJson.scripts &&
      currentArtifact.data.artifact.packageJson.scripts[scriptName]
    ) {
      return true
    } else {
      return {
        canRun: false,
        artifactStepResult: {
          executionStatus: ExecutionStatus.aborted,
          status: Status.skippedAsPassed,
          notes: [`skipping because missing ${scriptName}-script in artifact package.json`],
        },
      }
    }
  },
})
