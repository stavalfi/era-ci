import { execaCommand } from '../utils'
import { createStep, ExecutionStatus, Status } from '../create-step'

export const build = createStep({
  stepName: 'build',
  canRunStepOnArtifact: {
    customPredicate: async ({ rootPackageJson }) => {
      if (rootPackageJson.scripts && 'build' in rootPackageJson.scripts && rootPackageJson.scripts.build) {
        return {
          canRun: true,
          artifactStepResult: {
            notes: [],
          },
        }
      } else {
        return {
          canRun: false,
          artifactStepResult: {
            executionStatus: ExecutionStatus.aborted,
            status: Status.skippedAsPassed,
            notes: ['skipping because missing build-script in package.json'],
          },
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
      executionStatus: ExecutionStatus.done,
      status: Status.passed,
    }
  },
})
