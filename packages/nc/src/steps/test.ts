import { artifactPackageJsonHasScriptConstrain } from '../artifact-in-step-constrains'
import { createStep, RunStrategy } from '../create-step'
import { ExecutionStatus, Status } from '../types'
import { execaCommand } from '../utils'

export const test = createStep<{ testScriptName: string } | void, { testScriptName: string }>({
  stepName: 'test',
  normalizeStepConfigurations: async stepConfig => ({
    testScriptName: (typeof stepConfig === 'object' && stepConfig.testScriptName) || 'test',
  }),
  runIfAllConstrainsApply: {
    canRunStepOnArtifact: [
      artifactPackageJsonHasScriptConstrain({
        scriptName: 'test',
      }),
    ],
  },
  run: {
    runStrategy: RunStrategy.perArtifact,
    runStepOnArtifact: async ({ currentArtifact, stepConfigurations, log }) => {
      await execaCommand(`yarn run ${stepConfigurations.testScriptName}`, {
        cwd: currentArtifact.data.artifact.packagePath,
        stdio: 'inherit',
        log,
      })
      return { errors: [], notes: [], executionStatus: ExecutionStatus.done, status: Status.passed }
    },
  },
})
