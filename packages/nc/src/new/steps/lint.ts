import { execaCommand } from '../../utils'
import { createStep, StepStatus } from '../create-step'

export const lint = createStep<{ lintScriptName: string } | void, { lintScriptName: string }>({
  stepName: 'lint',
  normalizeStepConfigurations: async stepConfig => ({
    lintScriptName: (typeof stepConfig === 'object' && stepConfig.lintScriptName) || 'lint',
  }),
  canRunStepOnArtifact: {
    customPredicate: async ({ rootPackage }) => {
      if (
        rootPackage.packageJson.scripts &&
        'lint' in rootPackage.packageJson.scripts &&
        rootPackage.packageJson.scripts.lint
      ) {
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
  runStepOnRoot: async ({ repoPath }) => {
    await execaCommand('yarn lint', {
      cwd: repoPath,
      stdio: 'inherit',
    })

    return {
      status: StepStatus.passed,
    }
  },
})
