import {
  skipAsPassedIfStepIsDisabledConstrain,
  skipAsFailedIfStepResultFailedInCacheConstrain,
} from '@era-ci/constrains'
import { createStep } from '@era-ci/core'
import { LocalSequentalTaskQueue } from '@era-ci/task-queues'
import { execaCommand, ExecutionStatus, Status } from '@era-ci/utils'
import fse from 'fs-extra'
import path from 'path'

export const installRoot = createStep<LocalSequentalTaskQueue, { isStepEnabled: boolean }>({
  stepName: 'install-root',
  stepGroup: 'install',
  taskQueueClass: LocalSequentalTaskQueue,
  run: async ({ repoPath, log }) => ({
    globalConstrains: [skipAsPassedIfStepIsDisabledConstrain()],
    stepConstrains: [
      skipAsFailedIfStepResultFailedInCacheConstrain({
        stepNameToSearchInCache: 'validate-packages',
        skipAsPassedIfStepNotExists: true,
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

      log.info(`checking if there are uncommited changes after installing...`)

      const isRepoClean = await execaCommand('git diff --exit-code', {
        cwd: repoPath,
        stdio: 'inherit',
        log,
        reject: false,
      }).then(
        () => true,
        () => false,
      )

      if (!isRepoClean) {
        return {
          executionStatus: ExecutionStatus.done,
          status: Status.failed,
          notes: [`there are uncommited changes after installing dependencies. please commit and push them`],
        }
      }
    },
  }),
})
