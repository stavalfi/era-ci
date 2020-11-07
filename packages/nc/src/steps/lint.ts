import { createStep, RunStrategy } from '../create-step'
import { skipIfRootPackageJsonMissingScriptConstrain } from '../step-constrains'
import { LocalSequentalTaskQueueName, localSequentalTaskQueueName } from '../task-queues'
import { ExecutionStatus, Status } from '../types'
import { execaCommand } from '../utils'

export const lint = createStep<
  LocalSequentalTaskQueueName,
  { lintScriptName: string } | void,
  { lintScriptName: string }
>({
  stepName: 'lint',
  tasksQueueName: localSequentalTaskQueueName,
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
