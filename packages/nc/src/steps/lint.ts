import { execaCommand } from '../utils'
import { createStep, StepStatus } from '../create-step'

export const lint = createStep<{ lintScriptName: string } | void, { lintScriptName: string }>({
  stepName: 'lint',
  normalizeStepConfigurations: async stepConfig => ({
    lintScriptName: (typeof stepConfig === 'object' && stepConfig.lintScriptName) || 'lint',
  }),
  canRunStepOnArtifact: {
    customPredicate: async ({ rootPackageJson }) => {
      if (rootPackageJson.scripts && 'lint' in rootPackageJson.scripts && rootPackageJson.scripts.lint) {
        return {
          canRun: true,
          notes: [],
        }
      } else {
        return {
          canRun: false,
          notes: [],
          stepStatus: StepStatus.skippedAsPassed,
        }
      }
    },
  },
  runStepOnRoot: async ({ repoPath, log }) => {
    await execaCommand('yarn lint', {
      cwd: repoPath,
      stdio: 'inherit',
      log,
    })

    return {
      status: StepStatus.passed,
    }
  },
})
