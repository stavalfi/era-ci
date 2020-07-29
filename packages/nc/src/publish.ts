import { logger } from '@tahini/log'
import execa from 'execa'
import fse from 'fs-extra'
import isIp from 'is-ip'
import path from 'path'
import { buildFullDockerImageName } from './docker-utils'
import { travelGraph } from './graph'
import {
  Auth,
  Cache,
  Graph,
  PackageInfo,
  PackagesStepResult,
  ServerInfo,
  StepName,
  TargetInfo,
  TargetType,
  PackageStepResult,
  StepStatus,
  StepResult,
} from './types'
import { calculateCombinedStatus } from './utils'

const log = logger('publish')

async function updateVersionAndPublish({
  tryPublish,
  newVersion,
  packageInfo,
  startMs,
}: {
  packageInfo: PackageInfo
  newVersion: string
  tryPublish: () => Promise<PackageStepResult[StepName.publish]>
  startMs: number
}): Promise<PackageStepResult[StepName.publish]> {
  try {
    await fse.writeFile(
      path.join(packageInfo.packagePath, 'package.json'),
      JSON.stringify({ ...packageInfo.packageJson, version: newVersion }, null, 2),
    )
  } catch (error) {
    return {
      packageInfo,
      stepResult: {
        stepName: StepName.publish,
        durationMs: Date.now() - startMs,
        status: StepStatus.failed,
        notes: ['failed to update package.json to the new version'],
        error,
      },
    }
  }

  let result: PackageStepResult[StepName.publish]
  try {
    result = await tryPublish()
  } catch (error) {
    return {
      packageInfo,
      stepResult: {
        stepName: StepName.publish,
        durationMs: Date.now() - startMs,
        status: StepStatus.failed,
        notes: [],
        error,
      },
    }
  }

  await fse
    .writeFile(
      path.join(packageInfo.packagePath, 'package.json'),
      JSON.stringify({ ...packageInfo.packageJson, version: packageInfo.packageJson.version }, null, 2),
    )
    .catch(error => {
      log.error(`failed to revert package.json back to the old version. error: ${error}`)
      // log and ignore this error.
    })

  return result
}

async function publishNpm({
  newVersion,
  npmTarget,
  packageInfo,
  testsResult,
  npmRegistry,
  cache,
  auth,
  shouldPublish,
}: {
  packageInfo: PackageInfo
  npmTarget: TargetInfo<TargetType.npm>
  newVersion: string
  testsResult: StepResult<StepName.test>
  npmRegistry: ServerInfo
  cache: Cache
  auth: Auth
  shouldPublish: boolean
}): Promise<PackageStepResult[StepName.publish]> {
  const startMs = Date.now()
  if (!shouldPublish) {
    return {
      packageInfo,
      stepResult: {
        stepName: StepName.publish,
        durationMs: Date.now() - startMs,
        status: StepStatus.skippedAsPassed,
        notes: ['ci is configured to skip publish'],
      },
    }
  }

  if ([StepStatus.failed, StepStatus.skippedAsFailed].includes(testsResult.status)) {
    return {
      packageInfo,
      stepResult: {
        stepName: StepName.publish,
        durationMs: Date.now() - startMs,
        status: StepStatus.skippedAsFailedBecauseLastStepFailed,
        notes: ['skipping publish because the tests of this package failed'],
      },
    }
  }

  if (npmTarget.needPublish !== true) {
    return {
      packageInfo,
      stepResult: {
        stepName: StepName.publish,
        durationMs: Date.now() - startMs,
        status: StepStatus.skippedAsPassed,
        notes: [`this package was already published with the same content`],
        publishedVersion: npmTarget.needPublish.alreadyPublishedAsVersion,
      },
    }
  }

  log.verbose(`publishing npm target in package: "${packageInfo.packageJson.name}"`)

  const withPort = isIp.v4(npmRegistry.host) || npmRegistry.host === 'localhost' ? `:${npmRegistry.port}` : ''
  const npmRegistryAddress = `${npmRegistry.protocol}://${npmRegistry.host}${withPort}`

  // we set in cache that this image was published BEFORE we publish it to ensure that:
  // - if setAsPublished fails, we don't publish.
  // - if setAsPublished succeed, we may fail to publish
  // why? becuase when we check if we need to publish, the algorithm is:
  // - if cache doesn't know the hash, we can be sure this hash never published.
  // - else, we check in the registry anyway.
  // if we call setAsPublished after the publish, using the cache is pointless.
  await cache.publish.npm.setAsPublished(
    packageInfo.packageJson.name as string,
    packageInfo.packageHash,
    npmTarget.newVersion,
  )

  return updateVersionAndPublish({
    startMs,
    newVersion,
    packageInfo,
    tryPublish: async () => {
      await execa.command(
        `yarn publish --registry ${npmRegistryAddress} --non-interactive ${
          packageInfo.packageJson.name?.includes('@') ? '--access public' : ''
        }`,
        {
          cwd: packageInfo.packagePath,
          env: {
            // npm need this env-var for auth - this is needed only for production publishing.
            // in tests it doesn't do anything and we login manually to npm in tests.
            NPM_AUTH_TOKEN: auth.npmRegistryToken,
            NPM_TOKEN: auth.npmRegistryToken,
          },
        },
      )
      log.info(`published npm target in package: "${packageInfo.packageJson.name}"`)
      return {
        packageInfo,
        stepResult: {
          stepName: StepName.publish,
          durationMs: Date.now() - startMs,
          status: StepStatus.passed,
          notes: [`published version: ${newVersion}`],
          publishedVersion: newVersion,
        },
      }
    },
  })
}

async function publishDocker({
  repoPath,
  newVersion,
  dockerTarget,
  packageInfo,
  testsResult,
  dockerOrganizationName,
  dockerRegistry,
  cache,
  shouldPublish,
}: {
  packageInfo: PackageInfo
  dockerTarget: TargetInfo<TargetType.docker>
  dockerRegistry: ServerInfo
  dockerOrganizationName: string
  newVersion: string
  testsResult: StepResult<StepName.test>
  cache: Cache
  repoPath: string
  shouldPublish: boolean
}): Promise<PackageStepResult[StepName.publish]> {
  const startMs = Date.now()

  if (!shouldPublish) {
    return {
      packageInfo,
      stepResult: {
        stepName: StepName.publish,
        durationMs: Date.now() - startMs,
        status: StepStatus.skippedAsPassed,
        notes: ['ci is configured to skip publish'],
      },
    }
  }

  if ([StepStatus.failed, StepStatus.skippedAsFailed].includes(testsResult.status)) {
    return {
      packageInfo,
      stepResult: {
        stepName: StepName.publish,
        durationMs: Date.now() - startMs,
        status: StepStatus.skippedAsFailedBecauseLastStepFailed,
        notes: ['skipping publish because the tests of this package failed'],
      },
    }
  }

  if (dockerTarget.needPublish !== true) {
    return {
      packageInfo,
      stepResult: {
        stepName: StepName.publish,
        durationMs: Date.now() - startMs,
        status: StepStatus.skippedAsPassed,
        notes: [`this package was already published with the same content`],
        publishedVersion: dockerTarget.needPublish.alreadyPublishedAsVersion,
      },
    }
  }

  log.verbose('publishing docker target in package: "%s"', packageInfo.packageJson.name)

  const fullImageNameNewVersion = buildFullDockerImageName({
    dockerOrganizationName,
    dockerRegistry,
    packageJsonName: packageInfo.packageJson.name as string,
    imageTag: dockerTarget.newVersion,
  })

  // we set in cache that this image was published BEFORE we publish it to ensure that:
  // - if setAsPublished fails, we don't publish.
  // - if setAsPublished succeed, we may fail to publish
  // why? becuase when we check if we need to publish, the algorithm is:
  // - if cache doesn't know the hash, we can be sure this hash never published.
  // - else, we check in the registry anyway.
  // if we call setAsPublished after the publish, using the cache is pointless.
  await cache.publish.docker.setAsPublished(
    packageInfo.packageJson.name as string,
    packageInfo.packageHash,
    dockerTarget.newVersion,
  )

  // the package.json will probably copied to the image during the docker-build so we want to make sure the new version is in there
  return updateVersionAndPublish({
    startMs,
    packageInfo,
    newVersion,
    tryPublish: async () => {
      log.info(`building docker image "${fullImageNameNewVersion}" in package: "${packageInfo.packageJson.name}"`)

      try {
        await execa.command(
          `docker build --label latest-hash=${packageInfo.packageHash} --label latest-tag=${newVersion} -f Dockerfile -t ${fullImageNameNewVersion} ${repoPath}`,
          {
            cwd: packageInfo.packagePath,
            stdio: 'inherit',
          },
        )
      } catch (error) {
        return {
          packageInfo,
          stepResult: {
            stepName: StepName.publish,
            durationMs: Date.now() - startMs,
            status: StepStatus.failed,
            notes: ['failed to build the docker-image'],
            error,
          },
        }
      }
      log.info(`built docker image "${fullImageNameNewVersion}" in package: "${packageInfo.packageJson.name}"`)

      try {
        await execa.command(`docker push ${fullImageNameNewVersion}`)
      } catch (error) {
        return {
          packageInfo,
          stepResult: {
            stepName: StepName.publish,
            durationMs: Date.now() - startMs,
            status: StepStatus.failed,
            notes: [`failed to push the docker-image`],
            error,
          },
        }
      }

      log.info(`published docker target in package: "${packageInfo.packageJson.name}"`)

      return {
        packageInfo,
        stepResult: {
          stepName: StepName.publish,
          durationMs: Date.now() - startMs,
          status: StepStatus.passed,
          notes: [`published tag: ${newVersion}`],
          publishedVersion: newVersion,
        },
      }
    },
  })
}

export async function publish(
  orderedGraph: Graph<PackageStepResult[StepName.test]>,
  options: {
    shouldPublish: boolean
    repoPath: string
    npmRegistry: ServerInfo
    dockerRegistry: ServerInfo
    dockerOrganizationName: string
    cache: Cache
    auth: Auth
    executionOrder: number
  },
): Promise<PackagesStepResult<StepName.publish>> {
  const startMs = Date.now()

  log.info('publishing...')

  const publishResult: Graph<PackageStepResult[StepName.publish]> = await travelGraph(orderedGraph, {
    fromLeafs: true,
    mapData: async node => {
      switch (node.data.packageInfo.target?.targetType) {
        case TargetType.npm:
          return publishNpm({
            shouldPublish: options.shouldPublish,
            packageInfo: node.data.packageInfo,
            npmTarget: node.data.packageInfo.target as TargetInfo<TargetType.npm>,
            newVersion: (node.data.packageInfo.target?.needPublish === true &&
              node.data.packageInfo.target.newVersion) as string,
            testsResult: node.data.stepResult,
            npmRegistry: options.npmRegistry,
            auth: options.auth,
            cache: options.cache,
          })
        case TargetType.docker:
          return publishDocker({
            shouldPublish: options.shouldPublish,
            packageInfo: node.data.packageInfo,
            dockerTarget: node.data.packageInfo.target as TargetInfo<TargetType.docker>,
            newVersion: (node.data.packageInfo.target?.needPublish === true &&
              node.data.packageInfo.target.newVersion) as string,
            repoPath: options.repoPath,
            testsResult: node.data.stepResult,
            dockerOrganizationName: options.dockerOrganizationName,
            dockerRegistry: options.dockerRegistry,
            cache: options.cache,
          })
        default:
          return {
            ...node.data,
            stepResult: {
              stepName: StepName.publish,
              durationMs: 0,
              status: StepStatus.skippedAsPassed,
              notes: ['skipping publish because this is a private-npm-package'],
            },
          }
      }
    },
  })

  const withError = publishResult.filter(result => result.data.stepResult.error)
  if (withError.length > 0) {
    log.error(
      `the following packages had an error while publishing: ${withError
        .map(result => result.data.packageInfo.packageJson.name)
        .join(', ')}`,
    )
    withError.forEach(result => {
      log.error(`${result.data.packageInfo.packageJson.name}: `)
      log.error(result.data.stepResult.error)
    })
  }

  return {
    stepName: StepName.publish,
    durationMs: Date.now() - startMs,
    executionOrder: options.executionOrder,
    status: calculateCombinedStatus(publishResult.map(node => node.data.stepResult.status)),
    packagesResult: publishResult,
    notes: [],
  }
}
