import { createStepConstrain } from '@tahini/core'
import { ConstrainResult, ExecutionStatus, Status } from '@tahini/utils'

export const skipIfRootPackageJsonMissingScriptConstrain = createStepConstrain<{ scriptName: string }>({
  constrainName: 'skip-if-root-package-json-missing-script-constrain',
  constrain: async ({ constrainConfigurations, rootPackageJson }) => {
    const scriptName = constrainConfigurations.scriptName
    if (rootPackageJson.scripts && scriptName in rootPackageJson.scripts && rootPackageJson.scripts[scriptName]) {
      return {
        constrainResult: ConstrainResult.ignoreThisConstrain,
        stepResult: {
          errors: [],
          notes: [],
        },
      }
    } else {
      return {
        constrainResult: ConstrainResult.shouldSkip,
        stepResult: {
          errors: [],
          executionStatus: ExecutionStatus.aborted,
          status: Status.skippedAsPassed,
          notes: [`skipping because missing ${scriptName}-script in root package.json`],
        },
      }
    }
  },
})
