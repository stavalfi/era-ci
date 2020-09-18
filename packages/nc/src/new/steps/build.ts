import fse from 'fs-extra'
import { IPackageJson } from 'package-json-type'
import path from 'path'
import { execaCommand } from '../../utils'
import { createStep } from '../create-step'
import { StepStatus } from '../types'

export const build = createStep({
  stepName: 'build',
  runStep: async ({ repoPath, graph }) => {
    const startMs = Date.now()
    const rootPackageJson: IPackageJson = await fse.readJson(path.join(repoPath, 'package.json'))

    if (rootPackageJson.scripts && 'build' in rootPackageJson.scripts && rootPackageJson.scripts.build) {
      const result = await execaCommand('yarn build', {
        cwd: repoPath,
        stdio: 'inherit',
        reject: false,
      })

      return {
        stepSummary: {
          status: StepStatus.passed,
          notes: [],
        },
        packagesResult: graph.map(node => ({
          artifactName: node.data.artifact.packageJson.name!,
          stepResult: {
            status: result.failed ? StepStatus.failed : StepStatus.passed,
            notes: [],
            durationMs: Date.now() - startMs,
          },
        })),
      }
    } else {
      return {
        stepSummary: {
          notes: [],
        },
        packagesResult: graph.map(node => ({
          artifactName: node.data.artifact.packageJson.name!,
          stepResult: {
            status: StepStatus.skippedAsPassed,
            notes: ['no build-script in root package.json'],
            durationMs: Date.now() - startMs,
          },
        })),
      }
    }
  },
})
