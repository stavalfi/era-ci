import { skipIfStepResultNotPassedConstrain } from '@tahini/constrains'
import { createStepExperimental } from '@tahini/core'
import { LocalSequentalTaskQueue } from '@tahini/task-queues'
import { execaCommand } from '@tahini/utils'
import fse from 'fs-extra'
import path from 'path'

export const installRoot = createStepExperimental({
  stepName: 'install-root',
  taskQueueClass: LocalSequentalTaskQueue,
  run: ({ repoPath, log }) => ({
    stepConstrains: [
      skipIfStepResultNotPassedConstrain({
        stepName: 'validate-packages',
      }),
    ],
    stepLogic: async () => {
      const isExists = fse.existsSync(path.join(repoPath, 'yarn.lock'))

      if (!isExists) {
        throw new Error(`project must have yarn.lock file in the root folder of the repository`)
      }

      await execaCommand('yarn install', {
        cwd: repoPath,
        stdio: 'inherit',
        log,
      })
    },
  }),
})
