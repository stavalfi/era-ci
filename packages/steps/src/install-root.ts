import { skipIfStepResultNotPassedConstrain } from '@tahini/constrains'
import { LocalSequentalTaskQueue } from '@tahini/task-queues'
import { execaCommand } from '@tahini/utils'
import fse from 'fs-extra'
import path from 'path'
import { createStepExperimental } from '../../core/src/create-step/experimental'

export const installRoot = createStepExperimental({
  stepName: 'install-root',
  taskQueueClass: LocalSequentalTaskQueue,
  run: async ({ repoPath, log, runConstrains }) => ({
    stepConstrains: [
      skipIfStepResultNotPassedConstrain({
        stepName: 'validate-packages',
      }),
    ],
    step: async () => {
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
