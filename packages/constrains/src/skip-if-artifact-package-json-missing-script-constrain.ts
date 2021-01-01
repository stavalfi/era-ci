import { ConstrainResultType, createConstrain } from '@era-ci/core'
import { Artifact, ExecutionStatus, Node, Status } from '@era-ci/utils'

export const skipIfArtifactPackageJsonMissingScriptConstrain = createConstrain<{
  scriptName: string
  currentArtifact: Node<{ artifact: Artifact }>
}>({
  constrainName: 'skip-if-artifact-package-json-missing-script-constrain',
  constrain: async ({ constrainConfigurations: { currentArtifact, scriptName } }) => {
    if (
      currentArtifact.data.artifact.packageJson.scripts &&
      scriptName in currentArtifact.data.artifact.packageJson.scripts &&
      currentArtifact.data.artifact.packageJson.scripts[scriptName]
    ) {
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
          status: Status.skippedAsPassed,
          notes: [`skipping because missing ${scriptName}-script in artifact package.json`],
        },
      }
    }
  },
})
