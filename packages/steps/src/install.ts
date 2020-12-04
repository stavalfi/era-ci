import fse from 'fs-extra'
import path from 'path'
import { createStep, RunStrategy, skipIfStepResultNotPassedConstrain } from '@tahini/core'
import { execaCommand, ExecutionStatus, Status } from '@tahini/utils'
import { LocalSequentalTaskQueue } from '@tahini/task-queues'

export const install = createStep({
  stepName: 'install',
  taskQueueClass: LocalSequentalTaskQueue,
  constrains: {
    onStep: [
      skipIfStepResultNotPassedConstrain({
        stepName: 'validate-packages',
      }),
    ],
  },
  run: {
    runStrategy: RunStrategy.root,
    runStepOnRoot: async ({ repoPath, log }) => {
      const isExists = fse.existsSync(path.join(repoPath, 'yarn.lock'))

      if (!isExists) {
        throw new Error(`project must have yarn.lock file in the root folder of the repository`)
      }

      await execaCommand('yarn install', {
        cwd: repoPath,
        stdio: 'inherit',
        log,
      })

      return { errors: [], notes: [], executionStatus: ExecutionStatus.done, status: Status.passed }
    },
  },
})
