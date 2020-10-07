import { execaCommand } from '../utils'
import { createStep, ExecutionStatus, Status } from '../create-step'

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
          artifactStepResult: {
            notes: [],
          },
        }
      } else {
        return {
          canRun: false,
          artifactStepResult: {
            notes: ['skipping because missing lint-script in package.json'],
            executionStatus: ExecutionStatus.aborted,
            status: Status.skippedAsPassed,
          },
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
      notes: [],
      executionStatus: ExecutionStatus.done,
      status: Status.passed,
    }
  },
})
