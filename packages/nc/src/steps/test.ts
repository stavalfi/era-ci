import { createStep, RunStrategy } from '../create-step'
import { ExecutionStatus, Status } from '../types'
import { execaCommand } from '../utils'

export const test = createStep<{ testScriptName: string } | void, { testScriptName: string }>({
  stepName: 'test',
  normalizeStepConfigurations: async stepConfig => ({
    testScriptName: (typeof stepConfig === 'object' && stepConfig.testScriptName) || 'test',
  }),
  skip: {
    canRunStepOnArtifact: {
      customPredicate: async ({ currentArtifact, stepConfigurations }) =>
        stepConfigurations.testScriptName in (currentArtifact.data.artifact.packageJson.scripts || {})
          ? {
              canRun: true,
              artifactStepResult: {
                notes: [],
              },
            }
          : {
              canRun: false,
              artifactStepResult: {
                notes: [`skipping because missing test-script in package.json`],
                executionStatus: ExecutionStatus.aborted,
                status: Status.skippedAsPassed,
              },
            },
    },
  },
  run: {
    runStrategy: RunStrategy.perArtifact,
    runStepOnArtifact: async ({ currentArtifact, stepConfigurations, log }) => {
      await execaCommand(`yarn run ${stepConfigurations.testScriptName}`, {
        cwd: currentArtifact.data.artifact.packagePath,
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
