import { createStep } from '../create-step'
import { PackageUserStepResult, StepStatus } from '../types'

// async function testPackage({
//   cache,
//   node,
// }: {
//   node: Node<{ artifact: Artifact }>
//   cache: Cache
// }): Promise<PackageUserStepResult> {
//   const startMs = Date.now()

//   if (!node.data.artifact.packageJson.scripts?.test) {
//     return {
//       stepName: StepName.test,
//       status: StepStatus.skippedAsPassed,
//       durationMs: Date.now() - startMs,
//       notes: ['no test script'],
//     }
//   }

//   const flowId = await cache.test.isTestsRun(
//     node.data.artifact.packageJson.name as string,
//     node.data.artifact.packageHash,
//   )
//   if (flowId) {
//     const testsResult = await cache.test.isPassed(
//       node.data.artifact.packageJson.name as string,
//       node.data.artifact.packageHash,
//     )
//     if (testsResult) {
//       return {
//         stepName: StepName.test,
//         status: StepStatus.skippedAsPassed,
//         durationMs: Date.now() - startMs,
//         notes: [`nothing changed and tests already passed in flow: "${flowId}"`],
//       }
//     } else {
//       return {
//         stepName: StepName.test,
//         status: StepStatus.skippedAsFailed,
//         durationMs: Date.now() - startMs,
//         notes: [`nothing changed and tests already failed in flow: "${flowId}"`],
//       }
//     }
//   }

//   log.info(`running tests of ${node.data.artifact.packageJson.name}:`)

//   const testsResult = await execaCommand(`yarn test`, {
//     cwd: node.data.artifact.packagePath,
//     stdio: 'inherit',
//     reject: false,
//   })

//   await cache.test.setResult(
//     node.data.artifact.packageJson.name as string,
//     node.data.artifact.packageHash,
//     !testsResult.failed,
//   )

//   if (testsResult.failed) {
//     return {
//       stepName: StepName.test,
//       status: StepStatus.failed,
//       durationMs: Date.now() - startMs,
//       notes: [`tests failed`],
//     }
//   } else {
//     return {
//       stepName: StepName.test,
//       status: StepStatus.passed,
//       durationMs: Date.now() - startMs,
//       notes: [],
//     }
//   }
// }

export const test = createStep({
  stepName: 'test',
  requiredDependentStepStatus: [StepStatus.passed, StepStatus.skippedAsPassed],
  runStep: async ({ repoPath, graph }) => {
    const startMs = Date.now()

    const packagesResult: PackageUserStepResult[] = []
    for (const node of graph) {
      packagesResult.push({
        artifactName: node.data.artifact.packageJson.name!,
        stepResult: {
          durationMs: Date.now() - startMs,
          notes: [],
          status: StepStatus.passed,
        },
      })
    }

    return {
      stepSummary: {
        notes: [],
      },
      packagesResult,
    }
  },
})
