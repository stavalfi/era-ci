import { execaCommand } from '../utils'
import { createStep, Status } from '../create-step'

export const build = createStep({
  stepName: 'build',
  canRunStepOnArtifact: {
    customPredicate: async ({ rootPackageJson }) => {
      if (rootPackageJson.scripts && 'build' in rootPackageJson.scripts && rootPackageJson.scripts.build) {
        return {
          canRun: true,
          notes: [],
        }
      } else {
        return {
          canRun: false,
          notes: ['skipping because missing build-script in package.json'],
          stepStatus: Status.skippedAsPassed,
        }
      }
    },
  },
  runStepOnRoot: async ({ repoPath, log }) => {
    await execaCommand('yarn build', {
      cwd: repoPath,
      stdio: 'inherit',
      log,
    })

    return {
      notes: [],
      status: Status.passed,
    }
  },
})
