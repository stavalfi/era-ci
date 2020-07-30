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
import { CiOptions, TargetType, Cleanup, PackagesStepResult, StepName } from './types'
import { build, reportAndExitCi, getOrderedGraph, getPackages, install, shouldFailCi, exitCi } from './utils'
import { validatePackages } from './validate-packages'
import { deploy } from './deployment'

export { buildFullDockerImageName, dockerRegistryLogin, getDockerImageLabelsAndTags } from './docker-utils'
export { npmRegistryLogin } from './npm-utils'
export { TargetType } from './types'

const log = logger('ci-logic')

export async function ci<DeploymentClient>(options: CiOptions<DeploymentClient> & { repoPath: string }) {
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

    const installResult = await install({ graph: orderedGraph, repoPath: options.repoPath, executionOrder: 0 })

    const shouldFailAfterInstall = shouldFailCi({ install: installResult })

    if (shouldFailAfterInstall) {
      return reportAndExitCi({
        cleanups,
        graph: orderedGraph,
        shouldFail: true,
        startMs,
        steps: { install: installResult },
      })
    }

    const buildResult = await build({ graph: orderedGraph, repoPath: options.repoPath, executionOrder: 1 })

    const shouldFailAfterBuild = shouldFailCi({ install: installResult, build: buildResult })

    if (shouldFailAfterBuild) {
      return reportAndExitCi({
        cleanups,
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

    if (shouldFailAfterPublish) {
      return reportAndExitCi({
        cleanups,
        graph: orderedGraph,
        shouldFail: true,
        startMs,
        steps: { install: installResult, build: buildResult, test: testResult, publish: publishResult },
      })
    }

    let shouldFail: boolean
    let deploymentResult: PackagesStepResult<StepName.deployment> | undefined
    if ('deployment' in options) {
      deploymentResult = await deploy<DeploymentClient>(publishResult.packagesResult, {
        shouldDeploy: options.shouldDeploy,
        repoPath: options.repoPath,
        dockerRegistry: options.dockerRegistry,
        npmRegistry: options.npmRegistry,
        dockerOrganizationName: options.dockerOrganizationName,
        cache,
        auth: options.auth,
        delpoyment: options.deployment,
        executionOrder: 4,
      })

      const shouldFailAfterDeployment = shouldFailCi({
        install: installResult,
        build: buildResult,
        test: testResult,
        publish: publishResult,
      })
      shouldFail = shouldFailAfterDeployment
    } else {
      shouldFail = shouldFailAfterPublish
    }

    return reportAndExitCi({
      cleanups,
      graph: orderedGraph,
      shouldFail,
      startMs,
      steps: {
        install: installResult,
        build: buildResult,
        test: testResult,
        publish: publishResult,
        deployment: deploymentResult,
      },
    })
  } catch (error) {
    log.error(`CI failed unexpectedly. error:`)
    log.error(error)
    return exitCi({
      cleanups,
      shouldFail: true,
    })
  }
}
