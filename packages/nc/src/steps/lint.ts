import { createStep, RunStrategy } from '../create-step'
import { skipIfRootPackageJsonMissingScriptConstrain } from '../step-constrains'
import { LocalSequentalTaskQueue, LocalSequentalTaskQueueName } from '../task-queues'
import { ExecutionStatus, Status } from '../types'
import { execaCommand } from '../utils'

export const lint = createStep<
  LocalSequentalTaskQueueName,
  LocalSequentalTaskQueue,
  { lintScriptName: string } | void,
  { lintScriptName: string }
>({
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
