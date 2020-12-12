import { ConstrainResultType, createConstrain } from '@tahini/core'
import { ExecutionStatus, Status } from '@tahini/utils'

export const skipIfRootPackageJsonMissingScriptConstrain = createConstrain<{ scriptName: string }>({
  constrainName: 'skip-if-root-package-json-missing-script-constrain',
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
          notes: [`skipping because missing ${scriptName}-script in root package.json`],
        },
      }
    }
  },
})
