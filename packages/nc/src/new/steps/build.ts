import { execaCommand } from '../../utils'
import { createStep } from '../create-step'
import { StepStatus } from '../types'

export const build = createStep<void>({
  stepName: 'build',
  canRunStepOnArtifact: {
    customPredicate: async ({ rootPackage }) => {
      if (
        rootPackage.packageJson.scripts &&
        'build' in rootPackage.packageJson.scripts &&
        rootPackage.packageJson.scripts.build
      ) {
        return {
          canRun: true,
          notes: [],
        }
      } else {
        return {
          canRun: false,
          notes: [],
          stepStatus: StepStatus.skippedAsPassed,
        }
      }
    },
  },
  runStepOnRoot: async ({ repoPath }) => {
    await execaCommand('yarn build', {
      cwd: repoPath,
      stdio: 'inherit',
    })

    return {
      status: StepStatus.passed,
    }
  },
})
