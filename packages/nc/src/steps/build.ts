import { execaCommand } from '../utils'
import { createStep, RunStrategy } from '../create-step'
import { ExecutionStatus, Status } from '../types'
import { skipIfRootPackageJsonMissingScriptConstrain } from '../step-constrains'
import { localSequentalTaskQueue } from '../task-queues'

export const build = createStep({
  stepName: 'build',
  configureTaskQueue: localSequentalTaskQueue,
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
