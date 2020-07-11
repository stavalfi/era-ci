import execa from 'execa'
import Redis from 'ioredis'
import isIp from 'is-ip'
import path from 'path'
import { getPackageInfo } from './package-info'
import { calculatePackagesHash } from './packages-hash'
import { Graph, PackageInfo, Protocol, ServerInfo, TargetType } from './types'
import ncLog from '@tahini/log'
import _ from 'lodash'
import { IPackageJson } from 'package-json-type'

const log = ncLog('utils')

export const isRepoModified = async (rootPath: string) => {
  // todo: fix it. it doesn't work.
  return execa.command('git status --porcelain', { cwd: rootPath }).then(
    () => false,
    () => true,
  )
}

export async function getPackages(rootPath: string): Promise<string[]> {
  const result = await execa.command('yarn workspaces --json info', {
    cwd: rootPath,
  })
  const workspacesInfo: { location: string }[] = JSON.parse(JSON.parse(result.stdout).data)
  return Object.values(workspacesInfo)
    .map(workspaceInfo => workspaceInfo.location)
    .map(relativePackagePath => path.join(rootPath, relativePackagePath))
}

export async function getOrderedGraph({
  packagesInfo,
  rootPath,
  dockerOrganizationName,
  redisClient,
  dockerRegistry,
  npmRegistry,
}: {
  rootPath: string
  packagesInfo: {
    packagePath: string
    packageJson: IPackageJson
    packageName: string | undefined
    targetType: TargetType | undefined
  }[]
  npmRegistry: ServerInfo
  dockerRegistry: ServerInfo
  dockerOrganizationName: string
  redisClient: Redis.Redis
}): Promise<Graph<PackageInfo>> {
  log('calculate hash of every package and check which packages changed since their last publish')
  const orderedGraph = await calculatePackagesHash(
    rootPath,
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
        redisClient,
      }),
    })),
  )
  log('%d packages: %s', orderedGraph.length, orderedGraph.map(node => `"${node.data.packageJson.name}"`).join(', '))
  result.forEach(node => {
    log(`%s (%s): %O`, node.data.relativePackagePath, node.data.packageJson.name, {
      ..._.omit(node.data, ['packageJson']),
      packageJsonVersion: node.data.packageJson.version,
    })
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
