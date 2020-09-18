import { execaCommand } from '../../utils'
import { createStep } from '../create-step'
import { StepStatus } from '../types'

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
  runStepOnArtifact: async ({ allArtifacts, currentArtifactIndex, stepConfigurations }) => {
    const testsResult = await execaCommand(`yarn run ${stepConfigurations.testScriptName}`, {
      cwd: allArtifacts[currentArtifactIndex].data.artifact.packagePath,
      stdio: 'inherit',
      reject: false,
    })
    return {
      notes: [],
      status: testsResult.failed ? StepStatus.failed : StepStatus.passed,
    }
  },
})
