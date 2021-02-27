import {
  skipAsPassedIfStepIsDisabledConstrain,
  skipAsFailedIfStepResultFailedInCacheConstrain,
} from '@era-ci/constrains'
import { createStep } from '@era-ci/core'
import { LocalSequentalTaskQueue } from '@era-ci/task-queues'
import { determinePackageManager, execaCommand, ExecutionStatus, PackageManager, Status } from '@era-ci/utils'
import fs from 'fs'
import path from 'path'

export const installRoot = createStep<LocalSequentalTaskQueue, { isStepEnabled: boolean }>({
  stepName: 'install-root',
  stepGroup: 'install',
  taskQueueClass: LocalSequentalTaskQueue,
  run: async ({ repoPath, log, processEnv }) => ({
    globalConstrains: [skipAsPassedIfStepIsDisabledConstrain()],
    stepConstrains: [
      skipAsFailedIfStepResultFailedInCacheConstrain({
        stepNameToSearchInCache: 'validate-packages',
        skipAsPassedIfStepNotExists: true,
      }),
    ],
    stepLogic: async () => {
      const packageManager = await determinePackageManager({ repoPath, processEnv })

      log.info(`identified package-manager: "${packageManager}"`)

      const isExists = fs.existsSync(path.join(repoPath, 'yarn.lock'))

      if (!isExists) {
        throw new Error(`project must have yarn.lock file in the root folder of the repository`)
      }

      let installCommand: string

      switch (packageManager) {
        case PackageManager.yarn1: {
          installCommand = `yarn install`
          break
        }
        case PackageManager.yarn2: {
          installCommand = `yarn install --immutable`
          break
        }
      }

      await execaCommand(installCommand, {
        cwd: repoPath,
        stdio: 'inherit',
        log,
      })

      log.info(`checking if there are uncommited changes after installing...`)

      const isRepoClean = await execaCommand('git diff --exit-code', {
        cwd: repoPath,
        stdio: 'pipe',
        log,
        reject: false,
      })
      const { stdout: newFiels } = await execaCommand('git ls-files -o  --exclude-standard', {
        cwd: repoPath,
        stdio: 'pipe',
        log,
      })

      if (isRepoClean.failed || newFiels) {
        if (isRepoClean.failed) {
          log.error(`you have uncommited changes:`)
          log.error(isRepoClean.stdout)
        }
        if (newFiels) {
          log.error('uncommited new files:')
          log.error(newFiels)
        }
        return {
          executionStatus: ExecutionStatus.done,
          status: Status.failed,
          notes: [`there are uncommited changes after installing dependencies. please commit and push them`],
        }
      }
    },
  }),
})
