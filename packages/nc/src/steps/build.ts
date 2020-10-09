import { execaCommand } from '../utils'
import { createStep, RunStrategy } from '../create-step'
import { ExecutionStatus, Status } from '../types'

export const build = createStep({
  stepName: 'build',
  skip: {
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
