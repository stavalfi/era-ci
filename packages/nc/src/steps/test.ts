import { execaCommand } from '../utils'
import { createStep, Status } from '../create-step'

export const test = createStep<{ testScriptName: string } | void, { testScriptName: string }>({
  stepName: 'test',
  normalizeStepConfigurations: async stepConfig => ({
    testScriptName: (typeof stepConfig === 'object' && stepConfig.testScriptName) || 'test',
  }),
  canRunStepOnArtifact: {
    customPredicate: async ({ currentArtifact, stepConfigurations }) =>
      stepConfigurations.testScriptName in (currentArtifact.data.artifact.packageJson.scripts || {})
        ? { canRun: true, notes: [] }
        : {
            canRun: false,
            notes: [`skipping because missing test-script in package.json`],
            stepStatus: Status.skippedAsPassed,
          },
  },
  runStepOnArtifact: async ({ currentArtifact, stepConfigurations, log }) => {
    await execaCommand(`yarn run ${stepConfigurations.testScriptName}`, {
      cwd: currentArtifact.data.artifact.packagePath,
      stdio: 'inherit',
      log,
    })
    return {
      notes: [],
      status: Status.passed,
    }
  },
})
