/* eslint-disable no-console */

import { logger, logReport } from '@tahini/log'
import execa from 'execa'
import fse from 'fs-extra'
import { IPackageJson } from 'package-json-type'
import path from 'path'
import { intializeCache } from './cache'
import { dockerRegistryLogin } from './docker-utils'
import { npmRegistryLogin } from './npm-utils'
import { getPackageTargetType } from './package-info'
import { publish } from './publish'
import { generateReport } from './cli-report'
import { testPackages } from './test'
import { CiOptions, TargetType } from './types'
import { getOrderedGraph, getPackages, isRepoModified, shouldFailBuild } from './utils'
import { validatePackages } from './validate-packages'

export { buildFullDockerImageName, dockerRegistryLogin, getDockerImageLabelsAndTags } from './docker-utils'
export { npmRegistryLogin } from './npm-utils'
export { TargetType } from './types'

const log = logger('ci-logic')

export async function ci(options: CiOptions) {
  log.verbose(`starting ci execution. options: ${JSON.stringify(options, null, 2)}`)

  if (await isRepoModified(options.repoPath)) {
    // why: in the ci flow, we mutate and packageJsons and then git-commit-amend the changed, so I don't want to add external changed to the commit
    throw new Error(`can't run ci on modified git repository. please commit your changes and run the ci again.`)
  }

  // @ts-ignore
  if (!(await fse.exists(path.join(options.repoPath, 'yarn.lock')))) {
    throw new Error(`project must have yarn.lock file in the root folder of the repository`)
  }

  const packagesPath = await getPackages(options.repoPath)
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
    repoPath: options.repoPath,
    packagesInfo,
    dockerRegistry: options.dockerRegistry,
    dockerOrganizationName: options.dockerOrganizationName,
    npmRegistry: options.npmRegistry,
    cache,
  })

  log.info(`installing...`)
  await execa.command('yarn install', {
    cwd: options.repoPath,
    stdio: 'inherit',
  })

  const rootPackageJson: IPackageJson = await fse.readJson(path.join(options.repoPath, 'package.json'))

  if (rootPackageJson.scripts && 'build' in rootPackageJson.scripts && rootPackageJson.scripts.build) {
    log.info(`building...`)
    await execa.command('yarn build', {
      cwd: options.repoPath,
      stdio: 'inherit',
    })
  }

  const orderedTestsResult = await testPackages({ orderedGraph, cache, skipTests: options.skipTests })

  const packagesWithFailedTests = orderedTestsResult
    .filter(node => 'passed' in node.data.testsResult && !node.data.testsResult.passed)
    .map(node => node.data.packageJson.name)

  if (packagesWithFailedTests.length > 0) {
    log.error(`packages with failed tests: ${packagesWithFailedTests.join(', ')}`)
    process.exitCode = 1
  }

  const orderedPublishResult = await publish(orderedTestsResult, {
    shouldPublish: options.shouldPublish,
    isDryRun: options.isDryRun,
    repoPath: options.repoPath,
    dockerRegistry: options.dockerRegistry,
    npmRegistry: options.npmRegistry,
    dockerOrganizationName: options.dockerOrganizationName,
    cache,
    auth: options.auth,
  })

  logReport(
    generateReport({
      graph: orderedPublishResult,
      shouldPublish: options.shouldPublish,
    }),
  )

  await cache.disconnect()

  if (shouldFailBuild(orderedPublishResult).failBuild) {
    process.exitCode = 1
  }
}
