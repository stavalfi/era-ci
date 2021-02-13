import { ConstrainResultType, createConstrain } from '@era-ci/core'
import { Artifact, ExecutionStatus, Node, Status } from '@era-ci/utils'
import { k8sDeploymentConfiguration } from './types'

export const skipAsPassedIfPackageIsIgnoredFromDeployConstrain = createConstrain<
  { currentArtifact: Node<{ artifact: Artifact }> },
  { currentArtifact: Node<{ artifact: Artifact }> },
  Required<k8sDeploymentConfiguration>
>({
  constrainName: 'skip-as-passed-if-package-is-ignored-from-deploy-constrain',

  constrain: async ({ constrainConfigurations: { currentArtifact }, stepConfigurations }) => {
    if (stepConfigurations.ignorePackageNames.includes(currentArtifact.data.artifact.packageJson.name)) {
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
      result: { errors: [], notes: [] },
    }
  },
})
