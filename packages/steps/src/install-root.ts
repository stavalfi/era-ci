import { skipIfStepResultNotPassedConstrain } from '@tahini/constrains'
import { ConstrainResultType, StepEventType } from '@tahini/core'
import { LocalSequentalTaskQueue } from '@tahini/task-queues'
import { execaCommand, ExecutionStatus, Status } from '@tahini/utils'
import fse from 'fs-extra'
import path from 'path'
import { createStepExperimental } from '../../core/src/create-step/experimental'

export const installRoot = createStepExperimental({
  stepName: 'install-root',
  taskQueueClass: LocalSequentalTaskQueue,
  run: async ({ repoPath, log, runConstrains }) => {
    const constrainsResult = await runConstrains([
      skipIfStepResultNotPassedConstrain({
        stepName: 'validate-packages',
      }),
    ])

    if (constrainsResult.combinedResultType === ConstrainResultType.shouldSkip) {
      return {
        type: StepEventType.step,
        stepResult: constrainsResult.combinedResult,
      }
    }

    const isExists = fse.existsSync(path.join(repoPath, 'yarn.lock'))

    if (!isExists) {
      throw new Error(`project must have yarn.lock file in the root folder of the repository`)
    }

    await execaCommand('yarn install', {
      cwd: repoPath,
      stdio: 'inherit',
      log,
    })

    return {
      type: StepEventType.step,
      stepResult: { executionStatus: ExecutionStatus.done, status: Status.passed },
    }
  },
})
