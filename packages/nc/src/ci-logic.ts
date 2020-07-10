/* eslint-disable no-console */

import ncLog from '@tahini/log'
import execa from 'execa'
import fse from 'fs-extra'
import Redis from 'ioredis'
import { IPackageJson } from 'package-json-type'
import path from 'path'
import { dockerRegistryLogin } from './docker-utils'
import { npmRegistryLogin } from './npm-utils'
import { getPackageTargetType } from './package-info'
import { promote } from './promote'
import { publish } from './publish'
import { CiOptions, TargetType } from './types'
import { getOrderedGraph, getPackages, isRepoModified } from './utils'
import { validatePackages } from './validate-packages'

export { buildFullDockerImageName, dockerRegistryLogin, getDockerImageLabelsAndTags } from './docker-utils'
export { npmRegistryLogin } from './npm-utils'
export { TargetType } from './types'

const log = ncLog('nc')

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

  const packagesPath = await getPackages(options.rootPath)
  const packagesTargets = await Promise.all(
    packagesPath.map(async packagePath => ({
      packagePath,
      targetType: await getPackageTargetType(packagePath),
    })),
  )

  await validatePackages(packagesTargets)

  const npmPackages = packagesTargets.filter(({ targetType }) => targetType === TargetType.npm)
  const dockerPackages = packagesTargets.filter(({ targetType }) => targetType === TargetType.docker)

  if (dockerPackages.length > 0) {
    await dockerRegistryLogin({
      dockerRegistry: options.dockerRegistry,
      dockerRegistryToken: options.auth.dockerRegistryToken,
      dockerRegistryUsername: options.auth.dockerRegistryUsername,
    })
  }

  if (npmPackages.length > 0) {
    await npmRegistryLogin({
      npmRegistry: options.npmRegistry,
      npmRegistryUsername: options.auth.npmRegistryUsername,
      npmRegistryToken: options.auth.npmRegistryToken,
      npmRegistryEmail: options.auth.npmRegistryEmail,
    })
  }

  const redisClient = new Redis({
    host: options.redisServer.host,
    port: options.redisServer.port,
    ...(options.auth.redisPassword && { password: options.auth.redisPassword }),
  })

  const orderedGraph = await getOrderedGraph({
    rootPath: options.rootPath,
    packagesTargets,
    dockerRegistry: options.dockerRegistry,
    dockerOrganizationName: options.dockerOrganizationName,
    npmRegistry: options.npmRegistry,
    redisClient,
  })

  await execa.command('yarn install', {
    cwd: options.rootPath,
    stdio: 'inherit',
  })

  const rootPackageJson: IPackageJson = await fse.readJson(path.join(options.rootPath, 'package.json'))

  if (rootPackageJson.scripts && 'build' in rootPackageJson.scripts && rootPackageJson.scripts.build) {
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
