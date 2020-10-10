import { createStepConstrain } from '../create-step-constrain'
import { ExecutionStatus, Status } from '../types'

export const rootPackageJsonHasScriptConstrain = createStepConstrain<{ scriptName: string }>({
  constrainName: 'root-package-json-has-script-step-constrain',
  constrain: async ({ constrainConfigurations, rootPackageJson }) => {
    const scriptName = constrainConfigurations.scriptName
    if (rootPackageJson.scripts && scriptName in rootPackageJson.scripts && rootPackageJson.scripts[scriptName]) {
      return true
    } else {
      return {
        canRun: false,
        stepResult: {
          executionStatus: ExecutionStatus.aborted,
          status: Status.skippedAsPassed,
          notes: [`skipping because missing ${scriptName}-script in root package.json`],
        },
      }
    }
  },
})
