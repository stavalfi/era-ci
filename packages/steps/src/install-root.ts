import { skipIfStepIsDisabledConstrain, skipIfStepResultMissingOrFailedInCacheConstrain } from '@era-ci/constrains'
import { createStepExperimental } from '@era-ci/core'
import { LocalSequentalTaskQueue } from '@era-ci/task-queues'
import { execaCommand } from '@era-ci/utils'
import fse from 'fs-extra'
import path from 'path'

export const installRoot = createStepExperimental<LocalSequentalTaskQueue, { isStepEnabled: boolean }>({
  stepName: 'install-root',
  stepGroup: 'install',
  taskQueueClass: LocalSequentalTaskQueue,
  run: ({ repoPath, log }) => ({
    globalConstrains: [skipIfStepIsDisabledConstrain()],
    stepConstrains: [
      skipIfStepResultMissingOrFailedInCacheConstrain({
        stepNameToSearchInCache: 'validate-packages',
        skipAsPassedIfStepNotExists: false,
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
