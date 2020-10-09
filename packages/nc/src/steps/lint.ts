import { createStep, RunStrategy } from '../create-step'
import { ExecutionStatus, Status } from '../types'
import { execaCommand } from '../utils'

export const lint = createStep<{ lintScriptName: string } | void, { lintScriptName: string }>({
  stepName: 'lint',
  normalizeStepConfigurations: async stepConfig => ({
    lintScriptName: (typeof stepConfig === 'object' && stepConfig.lintScriptName) || 'lint',
  }),
  skip: {
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
  },
  run: {
    runStrategy: RunStrategy.root,
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
  },
})
