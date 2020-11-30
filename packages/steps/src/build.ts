import {
  createStep,
  RunStrategy,
  skipIfRootPackageJsonMissingScriptConstrain,
  LocalSequentalTaskQueue,
} from '@tahini/core'
import { ExecutionStatus, Status, execaCommand } from '@tahini/utils'

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
