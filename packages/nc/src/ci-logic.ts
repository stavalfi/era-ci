/* eslint-disable no-console */

import { logger } from '@tahini/log'
import execa from 'execa'
import fse from 'fs-extra'
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
import { intializeCache } from './cache'

export { buildFullDockerImageName, dockerRegistryLogin, getDockerImageLabelsAndTags } from './docker-utils'
export { npmRegistryLogin } from './npm-utils'
export { TargetType } from './types'

const log = logger('index')

export async function ci(options: CiOptions) {
  log.debug(`starting ci execution. options: ${JSON.stringify(options, null, 2)}`)

  if (await isRepoModified(options.rootPath)) {
    // why: in the ci flow, we mutate and packageJsons and then git-commit-amend the changed, so I don't want to add external changed to the commit
    throw new Error(`can't run ci on modified git repository. please commit your changes and run the ci again.`)
  }

  // @ts-ignore
  if (!(await fse.exists(path.join(options.rootPath, 'yarn.lock')))) {
    throw new Error(`project must have yarn.lock file in the root folder of the repository`)
  }

  const packagesPath = await getPackages(options.rootPath)
  const packagesInfo = await Promise.all(
    packagesPath.map(async packagePath => {
      const packageJson: IPackageJson = await fse.readJSON(path.join(packagePath, 'package.json'))
      return {
        packagePath,
        packageJson,
        packageName: packageJson.name,
        targetType: await getPackageTargetType(packagePath, packageJson),
      }
    }),
  )

  await validatePackages(packagesInfo)

  const npmPackages = packagesInfo.filter(({ targetType }) => targetType === TargetType.npm)
  const dockerPackages = packagesInfo.filter(({ targetType }) => targetType === TargetType.docker)

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

  const cache = await intializeCache({
    auth: options.auth,
    dockerOrganizationName: options.dockerOrganizationName,
    dockerRegistry: options.dockerRegistry,
    npmRegistry: options.npmRegistry,
    redisServer: options.redisServer,
  })

  const orderedGraph = await getOrderedGraph({
    rootPath: options.rootPath,
    packagesInfo,
    dockerRegistry: options.dockerRegistry,
    dockerOrganizationName: options.dockerOrganizationName,
    npmRegistry: options.npmRegistry,
    cache,
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
      cache,
      auth: options.auth,
    })
  }
  await Promise.all([cache.disconnect(), execa.command(`git reset HEAD --hard`, { cwd: options.rootPath })])
}
