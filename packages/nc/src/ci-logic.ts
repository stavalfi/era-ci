import { logger } from '@tahini/log'
import fse from 'fs-extra'
import { IPackageJson } from 'package-json-type'
import path from 'path'
import { intializeCache } from './cache'
import { dockerRegistryLogin } from './docker-utils'
import { npmRegistryLogin } from './npm-utils'
import { getPackageTargetType } from './package-info'
import { publish } from './publish'
import { testPackages } from './test'
import { CiOptions, TargetType } from './types'
import { build, exitCi, getOrderedGraph, getPackages, install, shouldFailCi } from './utils'
import { validatePackages } from './validate-packages'

export { buildFullDockerImageName, dockerRegistryLogin, getDockerImageLabelsAndTags } from './docker-utils'
export { npmRegistryLogin } from './npm-utils'
export { TargetType } from './types'

const log = logger('ci-logic')

export async function ci(options: CiOptions) {
  const startMs = Date.now()
  log.verbose(`starting ci execution. options: ${JSON.stringify(options, null, 2)}`)

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

  const installResult = await install({ graph: orderedGraph, repoPath: options.repoPath, executionOrder: 0 })

  const shouldFailAfterInstall = shouldFailCi({ install: installResult })

  if (shouldFailAfterInstall) {
    return exitCi({
      cache,
      graph: orderedGraph,
      shouldFail: true,
      startMs,
      steps: { install: installResult },
    })
  }

  const buildResult = await build({ graph: orderedGraph, repoPath: options.repoPath, executionOrder: 1 })

  const shouldFailAfterBuild = shouldFailCi({ install: installResult, build: buildResult })

  if (shouldFailAfterBuild) {
    return exitCi({
      cache,
      graph: orderedGraph,
      shouldFail: true,
      startMs,
      steps: { install: installResult, build: buildResult },
    })
  }

  const testResult = await testPackages({
    orderedGraph,
    cache,
    executionOrder: 2,
  })

  const publishResult = await publish(testResult.packagesResult, {
    shouldPublish: options.shouldPublish,
    repoPath: options.repoPath,
    dockerRegistry: options.dockerRegistry,
    npmRegistry: options.npmRegistry,
    dockerOrganizationName: options.dockerOrganizationName,
    cache,
    auth: options.auth,
    executionOrder: 3,
  })

  const shouldFailAfterPublish = shouldFailCi({
    install: installResult,
    build: buildResult,
    test: testResult,
    publish: publishResult,
  })

  return exitCi({
    cache,
    graph: orderedGraph,
    shouldFail: shouldFailAfterPublish,
    startMs,
    steps: { install: installResult, build: buildResult, test: testResult, publish: publishResult },
  })
}
