import { logger } from '@tahini/log'
import { Cache, Graph, Node, PackageInfo, TestsResult } from './types'
import execa from 'execa'

const log = logger('test')

async function testPackage({
  cache,
  node,
  skipTests,
}: {
  node: Node<PackageInfo>
  cache: Cache
  skipTests: boolean
}): Promise<TestsResult> {
  if (skipTests) {
    return {
      ...node.data,
      skipped: {
        reason: 'ci configurations specify to skip tests',
      },
    }
  }
  if (!node.data.packageJson.scripts?.test) {
    return {
      ...node.data,
      skipped: {
        reason: 'no test script',
      },
    }
  }

  if (await cache.test.isTestsRun(node.data.packageJson.name as string, node.data.packageHash)) {
    const testsResult = await cache.test.isPassed(node.data.packageJson.name as string, node.data.packageHash)
    if (testsResult) {
      return {
        ...node.data,
        skipped: {
          reason: 'nothing changed and tests already passed in last builds.',
        },
        passed: true,
      }
    } else {
      return {
        ...node.data,
        skipped: {
          reason:
            'nothing changed and tests already failed in last builds.\
if you have falky tests, please fix them or make a small change\
in your package to force the tests will run again',
        },
        passed: false,
      }
    }
  }

  const testsResult = await execa.command(`yarn test __tests__/tests.spec.ts`, {
    cwd: node.data.packagePath,
    stdio: 'inherit',
    reject: false,
  })

  await cache.test.setResult(node.data.packageJson.name as string, node.data.packageHash, !testsResult.failed)

  if (testsResult.failed) {
    return {
      ...node.data,
      skipped: false,
      passed: false,
    }
  } else {
    return {
      ...node.data,
      skipped: false,
      passed: true,
    }
  }
}

export async function testPackages({
  cache,
  orderedGraph,
  skipTests,
}: {
  orderedGraph: Graph<PackageInfo>
  cache: Cache
  skipTests: boolean
}): Promise<Graph<PackageInfo & { testsResult: TestsResult }>> {
  log.info('running tests...')
  const result = await Promise.all(
    orderedGraph.map(async node => ({
      ...node,
      data: {
        ...node.data,
        testsResult: await testPackage({ node, cache, skipTests }),
      },
    })),
  )
  log.info('tests result: ')
  result.forEach(node => {
    const testsResult = node.data.testsResult.skipped
      ? node.data.testsResult.skipped.reason
      : node.data.testsResult.passed
      ? 'passed'
      : 'failed'
    log.info(`package: ${node.data.packagePath}: ${testsResult}`)
  })

  return result
}
