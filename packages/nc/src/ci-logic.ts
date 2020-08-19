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
import { build, cleanup, getOrderedGraph, getPackages, install, reportAndExitCi, runSteps } from './utils'
import { validatePackages } from './validate-packages'

const log = logger('ci-logic')

export async function ci<DeploymentClient>(options: CiOptions<DeploymentClient>) {
  const cleanups: Cleanup[] = []

  try {
    const startMs = Date.now()
    log.verbose(`starting ci execution. options: ${JSON.stringify(options, null, 2)}`)

    const packagesPath = await getPackages(options.repoPath)

    const artifacts = await Promise.all(
      packagesPath.map(async (packagePath) => {
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

    if (dockerPackages.length > 0 && options.targetsInfo?.docker) {
      await dockerRegistryLogin({
        dockerRegistry: options.targetsInfo.docker.registry,
        dockerRegistryUsername: options.targetsInfo.docker.publishAuth.username,
        dockerRegistryToken: options.targetsInfo.docker.publishAuth.token,
        repoPath: options.repoPath,
      })
    }

    if (npmPackages.length > 0 && options.targetsInfo?.npm) {
      await npmRegistryLogin({
        npmRegistry: options.targetsInfo.npm.registry,
        npmRegistryUsername: options.targetsInfo.npm.publishAuth.username,
        npmRegistryToken: options.targetsInfo.npm.publishAuth.token,
        npmRegistryEmail: options.targetsInfo.npm.publishAuth.email,
        repoPath: options.repoPath,
      })
    }

    const cache = await intializeCache({
      flowId: options.flowId,
      redis: options.redis,
      targetsInfo: options.targetsInfo,
      repoPath: options.repoPath,
    })

    cleanups.push(cache.cleanup)

    const orderedGraph = await getOrderedGraph({
      repoPath: options.repoPath,
      artifacts,
      targetsInfo: options.targetsInfo,
    })

    const jsonReport = await runSteps({
      flowId: options.flowId,
      startFlowDateUtc: options.startFlowDateUtc,
      startMs,
      graph: orderedGraph,
      runSteps: [
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
          runStep: (stepsResultUntilNow) =>
            publish({
              orderedGraph: stepsResultUntilNow.test!.packagesResult,
              repoPath: options.repoPath,
              publishCache: cache['publish'],
              targetsInfo: options.targetsInfo,
              executionOrder: 3,
            }),
        },
        {
          stopPipelineOnFailure: false,
          runStep: (stepsResultUntilNow) =>
            deploy<DeploymentClient>({
              graph: stepsResultUntilNow.publish!.packagesResult,
              repoPath: options.repoPath,
              executionOrder: 4,
              targetsInfo: options.targetsInfo,
              deploymentCache: cache.deployment,
            }),
        },
      ],
    })

    await reportAndExitCi({ jsonReport, cleanups, cache })
  } catch (error) {
    log.error(`CI failed unexpectedly`, error)
    await cleanup(cleanups)
    process.exitCode = 1
  }
}
