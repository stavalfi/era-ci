import fse from 'fs-extra'
import path from 'path'
import { createStep } from '../create-step'
import { StepStatus } from '../types'

export const install = createStep({
  stepName: 'install',
  runStepOnAllArtifacts: async ({ repoPath, allArtifacts, cache }) => {
    const startMs = Date.now()
    const isExists = fse.existsSync(path.join(repoPath, 'yarn.lock'))

    if (!isExists) {
      throw new Error(`project must have yarn.lock file in the root folder of the repository`)
    }

    return {
      stepSummary: {
        notes: [],
      },
      artifactsResult: allArtifacts.map(node => ({
        artifactName: node.data.artifact.packageJson.name!,
        stepResult: {
          status: StepStatus.passed,
          notes: [],
          durationMs: Date.now() - startMs,
        },
      })),
    }
  },
})
