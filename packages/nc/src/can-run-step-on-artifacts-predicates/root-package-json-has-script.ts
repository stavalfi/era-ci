import { createCanRunStepOnArtifactsPredicate } from '../create-can-run-step-on-artifacts-predicate'
import { ExecutionStatus, Status } from '../types'

export const rootPackageJsonHasScript = createCanRunStepOnArtifactsPredicate<{ scriptName: string }>({
  predicateName: 'root-package-json-has-script',
  predicate: async ({ configurations, rootPackageJson }) => {
    const scriptName = configurations.scriptName
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
