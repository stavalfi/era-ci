import { createStepConstrain } from '../create-step-constrain'
import { ConstrainResult, ExecutionStatus, Status } from '../types'

export const runIfRootPackageJsonHasScriptConstrain = createStepConstrain<{ scriptName: string }>({
  constrainName: 'run-if-root-package-json-has-script-step-constrain',
  constrain: async ({ constrainConfigurations, rootPackageJson }) => {
    const scriptName = constrainConfigurations.scriptName
    if (rootPackageJson.scripts && scriptName in rootPackageJson.scripts && rootPackageJson.scripts[scriptName]) {
      return {
        constrainResult: ConstrainResult.shouldRun,
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
