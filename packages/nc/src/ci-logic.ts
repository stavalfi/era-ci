import { logger } from '@tahini/log'
import fse from 'fs-extra'
import { IPackageJson } from 'package-json-type'
import path from 'path'
import { intializeCache } from './cache'
import { deploy } from './deployment'
import { dockerRegistryLogin } from './docker-utils'
import { npmRegistryLogin } from './npm-utils'
import { getPackageTargetType } from './package-info'
import { publish } from './publish'
import { testPackages } from './test'
import { CiOptions, Cleanup, TargetType } from './types'
import { build, getOrderedGraph, getPackages, install, reportAndExitCi, runSteps, cleanup } from './utils'
import { validatePackages } from './validate-packages'

export { buildFullDockerImageName, dockerRegistryLogin, getDockerImageLabelsAndTags } from './docker-utils'
export { npmRegistryLogin } from './npm-utils'
export { TargetType } from './types'

const log = logger('ci-logic')

export async function ci<DeploymentClient>(options: CiOptions<DeploymentClient>) {
  const cleanups: Cleanup[] = []

  try {
    const startMs = Date.now()
    log.verbose(`starting ci execution. options: ${JSON.stringify(options, null, 2)}`)

    const packagesPath = await getPackages(options.repoPath)
    const artifacts = await Promise.all(
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

    await validatePackages(artifacts)

    const npmPackages = artifacts.filter(({ targetType }) => targetType === TargetType.npm)
    const dockerPackages = artifacts.filter(({ targetType }) => targetType === TargetType.docker)

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
    cleanups.push(cache.cleanup)

    const orderedGraph = await getOrderedGraph({
      repoPath: options.repoPath,
      artifacts,
      dockerRegistry: options.dockerRegistry,
      dockerOrganizationName: options.dockerOrganizationName,
      npmRegistry: options.npmRegistry,
      cache,
    })

    const jsonReport = await runSteps(startMs, orderedGraph, [
      {
        stopPipelineOnFailure: true,
        runStep: () => install({ graph: orderedGraph, repoPath: options.repoPath, executionOrder: 0 }),
      },
      {
        stopPipelineOnFailure: true,
        runStep: () => build({ graph: orderedGraph, repoPath: options.repoPath, executionOrder: 1 }),
      },
      {
        stopPipelineOnFailure: false,
        runStep: () =>
          testPackages({
            orderedGraph,
            cache,
            executionOrder: 2,
          }),
      },
      {
        stopPipelineOnFailure: false,
        runStep: stepsResultUntilNow =>
          publish(stepsResultUntilNow.test!.packagesResult, {
            shouldPublish: options.shouldPublish,
            repoPath: options.repoPath,
            dockerRegistry: options.dockerRegistry,
            npmRegistry: options.npmRegistry,
            dockerOrganizationName: options.dockerOrganizationName,
            cache,
            auth: options.auth,
            executionOrder: 3,
          }),
      },
      {
        stopPipelineOnFailure: false,
        runStep: stepsResultUntilNow =>
          options.deployment &&
          deploy<DeploymentClient>(stepsResultUntilNow.publish!.packagesResult, {
            shouldDeploy: options.shouldDeploy,
            repoPath: options.repoPath,
            dockerRegistry: options.dockerRegistry,
            npmRegistry: options.npmRegistry,
            dockerOrganizationName: options.dockerOrganizationName,
            cache,
            auth: options.auth,
            delpoyment: options.deployment,
            executionOrder: 4,
          }),
      },
    ])

    await reportAndExitCi(jsonReport, cleanups)
  } catch (error) {
    log.error(`CI failed unexpectedly`, error)
    await cleanup(cleanups)
    process.exitCode = 1
  }
}
