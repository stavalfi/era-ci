import { createStep, RunStrategy } from '@tahini/core'
import { skipIfStepResultNotPassedConstrain } from '@tahini/constrains'
import { LocalSequentalTaskQueue } from '@tahini/task-queues'
import { execaCommand, ExecutionStatus, Status } from '@tahini/utils'
import fse from 'fs-extra'
import path from 'path'
import { createStepExperimental } from '../../core/src/create-step/experimental'
import { isStepPassedInThisFlow } from '../../constrains/src/skip-if-step-result-not-passed-constrain'

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

export const installExperimental = createStepExperimental({
  stepName: 'install',
  taskQueueClass: LocalSequentalTaskQueue,
  run: async ({ repoPath, log, steps, stepsResultOfArtifactsByStep }) => {
    if (await isStepPassedInThisFlow({ steps, stepsResultOfArtifactsByStep, stepName: 'validate-packages' })) {
      const isExists = fse.existsSync(path.join(repoPath, 'yarn.lock'))

      if (!isExists) {
        throw new Error(`project must have yarn.lock file in the root folder of the repository`)
      }

      await execaCommand('yarn install', {
        cwd: repoPath,
        stdio: 'inherit',
        log,
      })
      return { executionStatus: ExecutionStatus.done, status: Status.passed }
    } else {
      return {
        executionStatus: ExecutionStatus.aborted,
        status: Status.skippedAsPassed,
        notes: [`validate-packages step not exist or didn't pass`],
      }
    }
  },
})
