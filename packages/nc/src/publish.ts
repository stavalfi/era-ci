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
  Artifact,
  PackagesStepResult,
  ServerInfo,
  StepName,
  TargetToPublish,
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
  artifact,
  startMs,
}: {
  artifact: Artifact
  newVersion: string
  tryPublish: () => Promise<PackageStepResult[StepName.publish]>
  startMs: number
}): Promise<PackageStepResult[StepName.publish]> {
  try {
    await fse.writeFile(
      path.join(artifact.packagePath, 'package.json'),
      JSON.stringify({ ...artifact.packageJson, version: newVersion }, null, 2),
    )
  } catch (error) {
    return {
      stepName: StepName.publish,
      durationMs: Date.now() - startMs,
      status: StepStatus.failed,
      notes: ['failed to update package.json to the new version'],
      error,
    }
  }

  let result: PackageStepResult[StepName.publish]
  try {
    result = await tryPublish()
  } catch (error) {
    return {
      stepName: StepName.publish,
      durationMs: Date.now() - startMs,
      status: StepStatus.failed,
      notes: [],
      error,
    }
  }

  await fse
    .writeFile(
      path.join(artifact.packagePath, 'package.json'),
      JSON.stringify({ ...artifact.packageJson, version: artifact.packageJson.version }, null, 2),
    )
    .catch(error => {
      log.error(`failed to revert package.json back to the old version`, error)
      // log and ignore this error.
    })

  return result
}

async function publishNpm({
  newVersion,
  npmTarget,
  artifact,
  testsResult,
  npmRegistry,
  cache,
  auth,
  shouldPublish,
}: {
  artifact: Artifact
  npmTarget: TargetToPublish<TargetType.npm>
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
      stepName: StepName.publish,
      durationMs: Date.now() - startMs,
      status: StepStatus.skippedAsPassed,
      notes: ['ci is configured to skip publish'],
    }
  }

  if ([StepStatus.failed, StepStatus.skippedAsFailed].includes(testsResult.status)) {
    return {
      stepName: StepName.publish,
      durationMs: Date.now() - startMs,
      status: StepStatus.skippedAsFailedBecauseLastStepFailed,
      notes: ['skipping publish because the tests of this package failed'],
    }
  }

  if (npmTarget.needPublish !== true) {
    return {
      stepName: StepName.publish,
      durationMs: Date.now() - startMs,
      status: StepStatus.skippedAsPassed,
      notes: [`this package was already published with the same content`],
      publishedVersion: npmTarget.needPublish.alreadyPublishedAsVersion,
    }
  }

  log.verbose(`publishing npm target in package: "${artifact.packageJson.name}"`)

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
    artifact.packageJson.name as string,
    artifact.packageHash,
    npmTarget.newVersion,
  )

  return updateVersionAndPublish({
    startMs,
    newVersion,
    artifact,
    tryPublish: async () => {
      await execa.command(
        `yarn publish --registry ${npmRegistryAddress} --non-interactive ${
          artifact.packageJson.name?.includes('@') ? '--access public' : ''
        }`,
        {
          cwd: artifact.packagePath,
          env: {
            // npm need this env-var for auth - this is needed only for production publishing.
            // in tests it doesn't do anything and we login manually to npm in tests.
            NPM_AUTH_TOKEN: auth.npmRegistryToken,
            NPM_TOKEN: auth.npmRegistryToken,
          },
        },
      )
      log.info(`published npm target in package: "${artifact.packageJson.name}"`)
      return {
        stepName: StepName.publish,
        durationMs: Date.now() - startMs,
        status: StepStatus.passed,
        notes: [`published version: ${newVersion}`],
        publishedVersion: newVersion,
      }
    },
  })
}

async function publishDocker({
  repoPath,
  newVersion,
  dockerTarget,
  artifact,
  testsResult,
  dockerOrganizationName,
  dockerRegistry,
  cache,
  shouldPublish,
}: {
  artifact: Artifact
  dockerTarget: TargetToPublish<TargetType.docker>
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
      stepName: StepName.publish,
      durationMs: Date.now() - startMs,
      status: StepStatus.skippedAsPassed,
      notes: ['ci is configured to skip publish'],
    }
  }

  if ([StepStatus.failed, StepStatus.skippedAsFailed].includes(testsResult.status)) {
    return {
      stepName: StepName.publish,
      durationMs: Date.now() - startMs,
      status: StepStatus.skippedAsFailedBecauseLastStepFailed,
      notes: ['skipping publish because the tests of this package failed'],
    }
  }

  if (dockerTarget.needPublish !== true) {
    return {
      stepName: StepName.publish,
      durationMs: Date.now() - startMs,
      status: StepStatus.skippedAsPassed,
      notes: [`this package was already published with the same content`],
      publishedVersion: dockerTarget.needPublish.alreadyPublishedAsVersion,
    }
  }

  log.verbose(`publishing docker target in package: "${artifact.packageJson.name}"`)

  const fullImageNameNewVersion = buildFullDockerImageName({
    dockerOrganizationName,
    dockerRegistry,
    packageJsonName: artifact.packageJson.name as string,
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
    artifact.packageJson.name as string,
    artifact.packageHash,
    dockerTarget.newVersion,
  )

  // the package.json will probably copied to the image during the docker-build so we want to make sure the new version is in there
  return updateVersionAndPublish({
    startMs,
    artifact,
    newVersion,
    tryPublish: async () => {
      log.info(`building docker image "${fullImageNameNewVersion}" in package: "${artifact.packageJson.name}"`)

      try {
        await execa.command(
          `docker build --label latest-hash=${artifact.packageHash} --label latest-tag=${newVersion} -f Dockerfile -t ${fullImageNameNewVersion} ${repoPath}`,
          {
            cwd: artifact.packagePath,
            stdio: 'inherit',
          },
        )
      } catch (error) {
        return {
          stepName: StepName.publish,
          durationMs: Date.now() - startMs,
          status: StepStatus.failed,
          notes: ['failed to build the docker-image'],
          error,
        }
      }
      log.info(`built docker image "${fullImageNameNewVersion}" in package: "${artifact.packageJson.name}"`)

      try {
        await execa.command(`docker push ${fullImageNameNewVersion}`)
      } catch (error) {
        return {
          stepName: StepName.publish,
          durationMs: Date.now() - startMs,
          status: StepStatus.failed,
          notes: [`failed to push the docker-image`],
          error,
        }
      }

      log.info(`published docker target in package: "${artifact.packageJson.name}"`)

      return {
        stepName: StepName.publish,
        durationMs: Date.now() - startMs,
        status: StepStatus.passed,
        notes: [`published tag: ${newVersion}`],
        publishedVersion: newVersion,
      }
    },
  })
}

export async function publish(
  orderedGraph: Graph<{ artifact: Artifact; stepResult: PackageStepResult[StepName.test] }>,
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

  const publishResult: Graph<{
    artifact: Artifact
    stepResult: PackageStepResult[StepName.publish]
  }> = await travelGraph(orderedGraph, {
    fromLeafs: true,
    mapData: async node => {
      switch (node.data.artifact.target?.targetType) {
        case TargetType.npm: {
          const publishResult = await publishNpm({
            shouldPublish: options.shouldPublish,
            artifact: node.data.artifact,
            npmTarget: node.data.artifact.target as TargetToPublish<TargetType.npm>,
            newVersion: (node.data.artifact.target?.needPublish === true &&
              node.data.artifact.target.newVersion) as string,
            testsResult: node.data.stepResult,
            npmRegistry: options.npmRegistry,
            auth: options.auth,
            cache: options.cache,
          })
          return {
            artifact: node.data.artifact,
            stepResult: publishResult,
          }
        }
        case TargetType.docker: {
          const publishResult = await publishDocker({
            shouldPublish: options.shouldPublish,
            artifact: node.data.artifact,
            dockerTarget: node.data.artifact.target as TargetToPublish<TargetType.docker>,
            newVersion: (node.data.artifact.target?.needPublish === true &&
              node.data.artifact.target.newVersion) as string,
            repoPath: options.repoPath,
            testsResult: node.data.stepResult,
            dockerOrganizationName: options.dockerOrganizationName,
            dockerRegistry: options.dockerRegistry,
            cache: options.cache,
          })
          return {
            artifact: node.data.artifact,
            stepResult: publishResult,
          }
        }
        default:
          return {
            artifact: node.data.artifact,
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
        .map(result => result.data.artifact.packageJson.name)
        .join(', ')}`,
    )
    withError.forEach(result => {
      log.error(`${result.data.artifact.packageJson.name}: `, result.data.stepResult.error)
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
