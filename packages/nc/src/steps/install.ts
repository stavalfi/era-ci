import fse from 'fs-extra'
import path from 'path'
import { createStep, RunStrategy } from '../create-step'
import { skipIfStepResultNotPassedConstrain } from '../step-constrains'
import { exampleTaskQueue } from '../task-queues'
import { ExecutionStatus, Status } from '../types'
import { execaCommand } from '../utils'

export const install = createStep({
  stepName: 'install',
  configureTaskQueue: exampleTaskQueue,
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
