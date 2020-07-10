/* eslint-disable no-console */

import execa from 'execa'
import fse from 'fs-extra'
import Redis from 'ioredis'
import ncLog from '@tahini/log'
import _ from 'lodash'
import path from 'path'
import { dockerRegistryLogin } from './docker-utils'
import { getPackageInfo } from './package-info'
import { calculatePackagesHash } from './packages-hash'
import { promote } from './promote'
import { publish } from './publish'
import { CiOptions, Graph, PackageInfo, ServerInfo } from './types'
import { IPackageJson } from 'package-json-type'

export { buildFullDockerImageName, dockerRegistryLogin, getDockerImageLabelsAndTags } from './docker-utils'
export { npmRegistryLogin } from './npm-utils'
export { TargetType } from './types'

const log = ncLog('ci')

async function getPackages(rootPath: string): Promise<string[]> {
  const result = await execa.command('yarn workspaces --json info', {
    cwd: rootPath,
  })
  const workspacesInfo: { location: string }[] = JSON.parse(JSON.parse(result.stdout).data)
  return Object.values(workspacesInfo)
    .map(workspaceInfo => workspaceInfo.location)
    .map(relativePackagePath => path.join(rootPath, relativePackagePath))
}

async function getOrderedGraph({
  packagesPath,
  rootPath,
  dockerOrganizationName,
  redisClient,
  dockerRegistry,
  npmRegistry,
}: {
  rootPath: string
  packagesPath: string[]
  npmRegistry: ServerInfo
  dockerRegistry: ServerInfo
  dockerOrganizationName: string
  redisClient: Redis.Redis
}): Promise<Graph<PackageInfo>> {
  const orderedGraph = await calculatePackagesHash(rootPath, packagesPath)
  return Promise.all(
    orderedGraph.map(async node => ({
      ...node,
      data: await getPackageInfo({
        dockerRegistry,
        npmRegistry,
        dockerOrganizationName,
        packageHash: node.data.packageHash,
        packagePath: node.data.packagePath,
        relativePackagePath: node.data.relativePackagePath,
        redisClient,
      }),
    })),
  )
}

const isRepoModified = async (rootPath: string) => {
  // todo: fix it. it doesn't work.
  return execa.command('git status --porcelain', { cwd: rootPath }).then(
    () => false,
    () => true,
  )
}

export async function ci(options: CiOptions) {
  log('starting ci execution. options: %O', options)

  if (await isRepoModified(options.rootPath)) {
    // why: in the ci flow, we mutate and packageJsons and then git-commit-amend the changed, so I don't want to add external changed to the commit
    throw new Error(`can't run ci on modified git repository. please commit your changes and run the ci again.`)
  }

  // @ts-ignore
  if (!(await fse.exists(path.join(options.rootPath, 'yarn.lock')))) {
    throw new Error(`project must have yarn.lock file in the root folder of the repository`)
  }

  await dockerRegistryLogin({
    dockerRegistry: options.dockerRegistry,
    dockerRegistryToken: options.auth.dockerRegistryToken,
    dockerRegistryUsername: options.auth.dockerRegistryUsername,
  })

  const redisClient = new Redis({
    host: options.redisServer.host,
    port: options.redisServer.port,
    ...(options.auth.redisPassword && { password: options.auth.redisPassword }),
  })

  log('calculate hash of every package and check which packages changed since their last publish')
  const packagesPath = await getPackages(options.rootPath)
  const orderedGraph = await getOrderedGraph({
    rootPath: options.rootPath,
    packagesPath,
    dockerRegistry: options.dockerRegistry,
    dockerOrganizationName: options.dockerOrganizationName,
    npmRegistry: options.npmRegistry,
    redisClient,
  })

  log('%d packages: %s', orderedGraph.length, orderedGraph.map(node => `"${node.data.packageJson.name}"`).join(', '))
  orderedGraph.forEach(node => {
    log(`%s (%s): %O`, node.data.relativePackagePath, node.data.packageJson.name, {
      ..._.omit(node.data, ['packageJson']),
      packageJsonVersion: node.data.packageJson.version,
    })
  })

  await execa.command('yarn install', {
    cwd: options.rootPath,
    stdio: 'inherit',
  })

  const rootPackageJson: IPackageJson = await fse.readJson(path.join(options.rootPath, 'package.json'))
  // @ts-ignore
  if (rootPackageJson.scripts?.build) {
    await execa.command('yarn build', {
      cwd: options.rootPath,
      stdio: 'inherit',
    })
  }

  if (!options.skipTests && rootPackageJson.scripts?.test) {
    await execa.command('yarn test', {
      cwd: options.rootPath,
      stdio: 'inherit',
    })
  }

  if (options.isMasterBuild) {
    await promote(orderedGraph)
    await publish(orderedGraph, {
      isDryRun: options.isDryRun,
      rootPath: options.rootPath,
      dockerRegistry: options.dockerRegistry,
      npmRegistry: options.npmRegistry,
      dockerOrganizationName: options.dockerOrganizationName,
      auth: options.auth,
    })
  }
  await Promise.all([redisClient.quit(), execa.command(`git reset HEAD --hard`, { cwd: options.rootPath })])
}