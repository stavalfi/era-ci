import { execaCommand } from '../../utils'
import { createStep, StepStatus } from '../create-step'

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
            stepStatus: StepStatus.skippedAsPassed,
          },
  },
  runStepOnArtifact: async ({ currentArtifact, stepConfigurations }) => {
    const testsResult = await execaCommand(`yarn run ${stepConfigurations.testScriptName}`, {
      cwd: currentArtifact.data.artifact.packagePath,
      stdio: 'inherit',
      reject: false,
    })
    return {
      notes: [],
      status: testsResult.failed ? StepStatus.failed : StepStatus.passed,
    }
  },
})
