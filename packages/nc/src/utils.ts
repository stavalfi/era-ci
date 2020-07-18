import { logger } from '@tahini/log'
import execa from 'execa'
import isIp from 'is-ip'
import _ from 'lodash'
import { IPackageJson } from 'package-json-type'
import path from 'path'
import { getPackageInfo } from './package-info'
import { calculatePackagesHash } from './packages-hash'
import { Cache, Graph, PackageInfo, Protocol, ServerInfo, TargetType, TestsResult, PublishResult } from './types'

const log = logger('utils')

export function shouldFailBuild(
  graph: Graph<PackageInfo & { testsResult: TestsResult; publishResult: PublishResult }>,
): { failBuild: boolean; reasons: string[] } {
  const packagesWithFailedTests = graph
    .filter(node => 'passed' in node.data.testsResult && !node.data.testsResult.passed)
    .map(node => node.data.packageJson.name)

  const packagesWithFailedPublish = graph
    .filter(
      node =>
        !node.data.publishResult.skipped &&
        'failed' in node.data.publishResult.published &&
        node.data.publishResult.published.failed,
    )
    .map(node => node.data.packageJson.name)

  const reasons: string[] = []
  if (packagesWithFailedTests.length > 0) {
    reasons.push('tests failed')
  }
  if (packagesWithFailedPublish.length > 0) {
    reasons.push('publish failed')
  }
  const failBuild = reasons.length > 0

  return { failBuild, reasons }
}

export const isRepoModified = async (repoPath: string) => {
  // todo: fix it. it doesn't work.
  return execa.command('git status --porcelain', { cwd: repoPath }).then(
    () => false,
    () => true,
  )
}

export async function getPackages(repoPath: string): Promise<string[]> {
  const result = await execa.command('yarn workspaces --json info', {
    cwd: repoPath,
  })
  const workspacesInfo: { location: string }[] = JSON.parse(JSON.parse(result.stdout).data)
  return Object.values(workspacesInfo)
    .map(workspaceInfo => workspaceInfo.location)
    .map(relativePackagePath => path.join(repoPath, relativePackagePath))
}

export async function getOrderedGraph({
  packagesInfo,
  repoPath,
  dockerOrganizationName,
  cache,
  dockerRegistry,
  npmRegistry,
}: {
  repoPath: string
  packagesInfo: {
    packagePath: string
    packageJson: IPackageJson
    packageName: string | undefined
    targetType: TargetType | undefined
  }[]
  npmRegistry: ServerInfo
  dockerRegistry: ServerInfo
  dockerOrganizationName: string
  cache: Cache
}): Promise<Graph<PackageInfo>> {
  log.verbose('calculate hash of every package and check which packages changed since their last publish')
  const orderedGraph = await calculatePackagesHash(
    repoPath,
    packagesInfo.map(({ packagePath }) => packagePath),
  )
  const result = await Promise.all(
    orderedGraph.map(async node => ({
      ...node,
      data: await getPackageInfo({
        dockerRegistry,
        npmRegistry,
        targetType: packagesInfo.find(({ packagePath }) => node.data.packagePath === packagePath)
          ?.targetType as TargetType,
        dockerOrganizationName,
        packageHash: node.data.packageHash,
        packagePath: node.data.packagePath,
        relativePackagePath: node.data.relativePackagePath,
        cache,
      }),
    })),
  )
  log.verbose(
    `${orderedGraph.length} packages: ${orderedGraph.map(node => `"${node.data.packageJson.name}"`).join(', ')}`,
  )
  result.forEach(node => {
    log.verbose(
      `${node.data.relativePackagePath} (${node.data.packageJson.name}): ${JSON.stringify(
        {
          ..._.omit(node.data, ['packageJson']),
          packageJsonVersion: node.data.packageJson.version,
        },
        null,
        2,
      )}`,
    )
  })

  return result
}

export function toServerInfo({ protocol, host, port }: { protocol?: string; host: string; port?: number }): ServerInfo {
  const paramsToString = JSON.stringify({ protocol, host, port }, null, 2)
  if (protocol && protocol !== 'http' && protocol !== 'https') {
    throw new Error(`protocol is not supported: ${protocol}. params: ${paramsToString}`)
  }
  if (isIp.v6(host)) {
    throw new Error(`ipv6 is not supported: ${host}. params: ${paramsToString}`)
  }
  const selectedProtocol: Protocol | undefined = host.includes('://')
    ? (host.split('://')[0] as Protocol)
    : (protocol as Protocol)
  const hostWithoutProtocol = host.replace(`${selectedProtocol}://`, '')
  if (host.includes(':')) {
    const combined = hostWithoutProtocol.split(':')
    return {
      protocol: selectedProtocol,
      host: combined[0],
      port: Number(combined[1]),
    }
  } else {
    const selectedPort = port || (selectedProtocol === 'http' ? 80 : selectedProtocol === 'https' ? 443 : undefined)
    if (selectedPort === undefined) {
      throw new Error(`cant find the port in: ${paramsToString}`)
    }
    return {
      protocol: selectedProtocol,
      host: hostWithoutProtocol,
      port: selectedPort,
    }
  }
}
