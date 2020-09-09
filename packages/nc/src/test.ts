import { logger } from '@tahini/log'
import { Artifact, Cache, Graph, Node, PackagesStepResult, PackageStepResult, StepName, StepStatus } from './types'
import { calculateCombinedStatus, execaCommand } from './utils'

const log = logger('test')

async function testPackage({
  cache,
  node,
}: {
  node: Node<{ artifact: Artifact }>
  cache: Cache
}): Promise<PackageStepResult[StepName.test]> {
  const startMs = Date.now()

  if (!node.data.artifact.packageJson.scripts?.test) {
    return {
      stepName: StepName.test,
      status: StepStatus.skippedAsPassed,
      durationMs: Date.now() - startMs,
      notes: ['no test script'],
    }
  }

  const flowId = await cache.test.isTestsRun(
    node.data.artifact.packageJson.name as string,
    node.data.artifact.packageHash,
  )
  if (flowId) {
    const testsResult = await cache.test.isPassed(
      node.data.artifact.packageJson.name as string,
      node.data.artifact.packageHash,
    )
    if (testsResult) {
      return {
        stepName: StepName.test,
        status: StepStatus.skippedAsPassed,
        durationMs: Date.now() - startMs,
        notes: [`nothing changed and tests already passed in flow: "${flowId}"`],
      }
    } else {
      return {
        stepName: StepName.test,
        status: StepStatus.skippedAsFailed,
        durationMs: Date.now() - startMs,
        notes: [`nothing changed and tests already failed in flow: "${flowId}"`],
      }
    }
  }

  log.info(`running tests of ${node.data.artifact.packageJson.name}:`)

  const testsResult = await execaCommand(`yarn test`, {
    cwd: node.data.artifact.packagePath,
    stdio: 'inherit',
    reject: false,
  })

  await cache.test.setResult(
    node.data.artifact.packageJson.name as string,
    node.data.artifact.packageHash,
    !testsResult.failed,
  )

  if (testsResult.failed) {
    return {
      stepName: StepName.test,
      status: StepStatus.failed,
      durationMs: Date.now() - startMs,
      notes: [`tests failed`],
    }
  } else {
    return {
      stepName: StepName.test,
      status: StepStatus.passed,
      durationMs: Date.now() - startMs,
      notes: [],
    }
  }
}

export async function testPackages({
  cache,
  orderedGraph,
  executionOrder,
}: {
  orderedGraph: Graph<{ artifact: Artifact }>
  cache: Cache
  executionOrder: number
}): Promise<PackagesStepResult<StepName.test>> {
  const startMs = Date.now()
  log.info('running tests...')

  const packagesResult: Graph<{ artifact: Artifact; stepResult: PackageStepResult[StepName.test] }> = []
  for (const node of orderedGraph) {
    const result = {
      ...node,
      data: {
        artifact: node.data.artifact,
        stepResult: await testPackage({ node, cache }),
      },
    }
    packagesResult.push(result)
  }

  return {
    stepName: StepName.test,
    durationMs: Date.now() - startMs,
    executionOrder,
    status: calculateCombinedStatus(packagesResult.map(node => node.data.stepResult.status)),
    packagesResult,
    notes: [],
  }
}
