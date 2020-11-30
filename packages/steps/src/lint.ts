import {
  createStep,
  LocalSequentalTaskQueue,
  RunStrategy,
  skipIfRootPackageJsonMissingScriptConstrain,
} from '@tahini/core'
import { execaCommand, ExecutionStatus, Status } from '@tahini/utils'

export const lint = createStep<LocalSequentalTaskQueue, { lintScriptName: string } | void, { lintScriptName: string }>({
  stepName: 'lint',
  taskQueueClass: LocalSequentalTaskQueue,
  normalizeStepConfigurations: async stepConfig => ({
    lintScriptName: (typeof stepConfig === 'object' && stepConfig.lintScriptName) || 'lint',
  }),
  constrains: {
    onStep: [
      skipIfRootPackageJsonMissingScriptConstrain({
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

      return { errors: [], notes: [], executionStatus: ExecutionStatus.done, status: Status.passed }
    },
  },
})
