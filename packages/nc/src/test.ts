import { logger } from '@tahini/log'
import execa from 'execa'
import { Cache, Graph, Node, PackageInfo, PackagesStepResult, PackageStepResult, StepName, StepStatus } from './types'
import { calculateCombinedStatus } from './utils'

const log = logger('test')

async function testPackage({
  cache,
  node,
  skipTests,
}: {
  node: Node<{ packageInfo: PackageInfo }>
  cache: Cache
  skipTests: boolean
}): Promise<PackageStepResult[StepName.test]> {
  const startMs = Date.now()

  if (skipTests) {
    return {
      ...node.data,
      stepResult: {
        stepName: StepName.test,
        status: StepStatus.skippedAsPassed,
        durationMs: Date.now() - startMs,
        notes: ['ci configurations specify to skip tests'],
      },
    }
  }

  if (!node.data.packageInfo.packageJson.scripts?.test) {
    return {
      ...node.data,
      stepResult: {
        stepName: StepName.test,
        status: StepStatus.skippedAsPassed,
        durationMs: Date.now() - startMs,
        notes: ['no test script'],
      },
    }
  }

  if (
    await cache.test.isTestsRun(node.data.packageInfo.packageJson.name as string, node.data.packageInfo.packageHash)
  ) {
    const testsResult = await cache.test.isPassed(
      node.data.packageInfo.packageJson.name as string,
      node.data.packageInfo.packageHash,
    )
    if (testsResult) {
      return {
        ...node.data,
        stepResult: {
          stepName: StepName.test,
          status: StepStatus.skippedAsPassed,
          durationMs: Date.now() - startMs,
          notes: ['nothing changed and tests already passed in last builds.'],
        },
      }
    } else {
      return {
        ...node.data,
        stepResult: {
          stepName: StepName.test,
          status: StepStatus.skippedAsFailed,
          durationMs: Date.now() - startMs,
          notes: ['nothing changed and tests already failed in last builds.'],
        },
      }
    }
  }

  const testsResult = await execa.command(`yarn test`, {
    cwd: node.data.packageInfo.packagePath,
    stdio: 'inherit',
    reject: false,
  })

  await cache.test.setResult(
    node.data.packageInfo.packageJson.name as string,
    node.data.packageInfo.packageHash,
    !testsResult.failed,
  )

  if (testsResult.failed) {
    return {
      ...node.data,
      stepResult: {
        stepName: StepName.test,
        status: StepStatus.failed,
        durationMs: Date.now() - startMs,
        notes: [],
      },
    }
  } else {
    return {
      ...node.data,
      stepResult: {
        stepName: StepName.test,
        status: StepStatus.passed,
        durationMs: Date.now() - startMs,
        notes: [],
      },
    }
  }
}

export async function testPackages({
  cache,
  orderedGraph,
  skipTests,
  executionOrder,
}: {
  orderedGraph: Graph<{ packageInfo: PackageInfo }>
  cache: Cache
  skipTests: boolean
  executionOrder: number
}): Promise<PackagesStepResult<StepName.test>> {
  const startMs = Date.now()
  log.info('running tests...')
  const packagesResult: Graph<PackageStepResult[StepName.test]> = await Promise.all(
    orderedGraph.map(async node => ({
      ...node,
      data: {
        ...node.data,
        ...(await testPackage({ node, cache, skipTests })),
      },
    })),
  )

  return {
    stepName: StepName.test,
    durationMs: Date.now() - startMs,
    executionOrder,
    status: calculateCombinedStatus(packagesResult.map(node => node.data.stepResult.status)),
    packagesResult,
    notes: [],
  }
}
