import { createStep, RunStrategy } from '../create-step'
import { rootPackageJsonHasScriptConstrain } from '../step-constrains'
import { ExecutionStatus, Status } from '../types'
import { execaCommand } from '../utils'

export const lint = createStep<{ lintScriptName: string } | void, { lintScriptName: string }>({
  stepName: 'lint',
  normalizeStepConfigurations: async stepConfig => ({
    lintScriptName: (typeof stepConfig === 'object' && stepConfig.lintScriptName) || 'lint',
  }),
  runIfAllConstrainsApply: {
    canRunStep: [
      rootPackageJsonHasScriptConstrain({
        scriptName: 'lint',
      }),
    ],
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
