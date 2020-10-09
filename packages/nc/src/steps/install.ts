import fse from 'fs-extra'
import path from 'path'
import { execaCommand } from '../utils'
import { createStep, RunStrategy } from '../create-step'
import { ExecutionStatus, Status } from '../types'

export const install = createStep({
  stepName: 'install',
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

      return {
        notes: [],
        executionStatus: ExecutionStatus.done,
        status: Status.passed,
      }
    },
  },
})
