import { createStep, RunStrategy } from '../create-step'
import { skipIfRootPackageJsonMissingScriptConstrain } from '../step-constrains'
import { LocalSequentalTaskQueue } from '../task-queues'
import { ExecutionStatus, Status } from '../types'
import { execaCommand } from '../utils'

export const build = createStep({
  stepName: 'build',
  taskQueueClass: LocalSequentalTaskQueue,
  constrains: {
    onStep: [
      skipIfRootPackageJsonMissingScriptConstrain({
        scriptName: 'build',
      }),
    ],
  },
  run: {
    runStrategy: RunStrategy.root,
    runStepOnRoot: async ({ repoPath, log }) => {
      await execaCommand('yarn build', {
        cwd: repoPath,
        stdio: 'inherit',
        log,
      })

      return { errors: [], notes: [], executionStatus: ExecutionStatus.done, status: Status.passed }
    },
  },
})
