import { ConstrainResultType, createConstrain } from '@era-ci/core'
import { ExecutionStatus, Status } from '@era-ci/utils'

export const skipAsPassedIfRootPackageJsonMissingScriptConstrain = createConstrain<{ scriptName: string }>({
  constrainName: 'skip-as-passed-if-root-package-json-missing-script-constrain',
  constrain: async ({ constrainConfigurations, rootPackageJson }) => {
    const scriptName = constrainConfigurations.scriptName
    if (rootPackageJson.scripts && scriptName in rootPackageJson.scripts && rootPackageJson.scripts[scriptName]) {
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
          notes: [`skipping because missing script: "${scriptName}" in root package.json`],
        },
      }
    }
  },
})
