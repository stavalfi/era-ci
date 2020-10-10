import { execaCommand } from '../utils'
import { createStep, RunStrategy } from '../create-step'
import { ExecutionStatus, Status } from '../types'
import { rootPackageJsonHasScriptConstrain } from '../step-constrains'

export const build = createStep({
  stepName: 'build',
  runIfAllConstrainsApply: {
    canRunStep: [
      rootPackageJsonHasScriptConstrain({
        scriptName: 'build',
      }),
    ],
  },
  run: {
    runStrategy: RunStrategy.root,
    runStepOnRoot: async ({ repoPath, log }) => {
      await execaCommand('yarn build', {
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
