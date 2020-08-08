import { logger } from '@tahini/log'
import execa from 'execa'
import fse from 'fs-extra'
import isIp from 'is-ip'
import path from 'path'
import { buildFullDockerImageName } from './docker-utils'
import { travelGraph } from './graph'
import {
  Artifact,
  Cache,
  Graph,
  PackagesStepResult,
  PackageStepResult,
  PublishCache,
  StepName,
  StepStatus,
  TargetType,
  TargetsInfo,
  TargetInfo,
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

async function publishNpm<DeploymentClient>({
  newVersion,
  artifact,
  setAsPublishedCache,
  targetPublishInfo,
}: {
  artifact: Artifact
  newVersion: string
  setAsPublishedCache: PublishCache['setAsPublished']
  targetPublishInfo: TargetInfo<TargetType.npm, DeploymentClient>
}): Promise<PackageStepResult[StepName.publish]> {
  const startMs = Date.now()

  log.verbose(`publishing npm target in package: "${artifact.packageJson.name}"`)

  const withPort =
    isIp.v4(targetPublishInfo.registry.host) || targetPublishInfo.registry.host === 'localhost'
      ? `:${targetPublishInfo.registry.port}`
      : ''
  const npmRegistryAddress = `${targetPublishInfo.registry.protocol}://${targetPublishInfo.registry.host}${withPort}`

  // we set in cache that this image was published BEFORE we publish it to ensure that:
  // - if setAsPublished fails, we don't publish.
  // - if setAsPublished succeed, we may fail to publish
  // why? becuase when we check if we need to publish, the algorithm is:
  // - if cache doesn't know the hash, we can be sure this hash never published.
  // - else, we check in the registry anyway.
  // if we call setAsPublished after the publish, using the cache is pointless.
  await setAsPublishedCache(artifact.packageJson.name as string, artifact.packageHash, newVersion)

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
            NPM_AUTH_TOKEN: targetPublishInfo.publishAuth.token,
            NPM_TOKEN: targetPublishInfo.publishAuth.token,
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

async function publishDocker<DeploymentClient>({
  repoPath,
  newVersion,
  artifact,
  setAsPublishedCache,
  targetPublishInfo,
}: {
  artifact: Artifact
  newVersion: string
  setAsPublishedCache: PublishCache['setAsPublished']
  repoPath: string
  targetPublishInfo: TargetInfo<TargetType.docker, DeploymentClient>
}): Promise<PackageStepResult[StepName.publish]> {
  const startMs = Date.now()

  log.verbose(`publishing docker target in package: "${artifact.packageJson.name}"`)

  const fullImageNameNewVersion = buildFullDockerImageName({
    dockerOrganizationName: targetPublishInfo.dockerOrganizationName,
    dockerRegistry: targetPublishInfo.registry,
    packageJsonName: artifact.packageJson.name as string,
    imageTag: newVersion,
  })

  // we set in cache that this image was published BEFORE we publish it to ensure that:
  // - if setAsPublished fails, we don't publish.
  // - if setAsPublished succeed, we may fail to publish
  // why? becuase when we check if we need to publish, the algorithm is:
  // - if cache doesn't know the hash, we can be sure this hash never published.
  // - else, we check in the registry anyway.
  // if we call setAsPublished after the publish, using the cache is pointless.
  await setAsPublishedCache(artifact.packageJson.name as string, artifact.packageHash, newVersion)

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

      log.info(`published docker image "${fullImageNameNewVersion}" in package: "${artifact.packageJson.name}"`)

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

export async function publish<DeploymentClient>({
  cache,
  executionOrder,
  orderedGraph,
  repoPath,
  targetsInfo,
}: {
  orderedGraph: Graph<{ artifact: Artifact; stepResult: PackageStepResult[StepName.test] }>
  targetsInfo?: TargetsInfo<DeploymentClient>
  repoPath: string
  cache: Cache
  executionOrder: number
}): Promise<PackagesStepResult<StepName.publish>> {
  const startMs = Date.now()

  log.info('publishing...')

  if (!targetsInfo || Object.values(targetsInfo).filter(Boolean).length === 0) {
    const durationMs = Date.now() - startMs
    return {
      stepName: StepName.publish,
      durationMs,
      executionOrder,
      status: StepStatus.skippedAsPassed,
      packagesResult: orderedGraph.map(node => ({
        ...node,
        data: {
          artifact: node.data.artifact,
          stepResult: {
            stepName: StepName.publish,
            durationMs,
            status: StepStatus.skippedAsPassed,
            notes: [],
          },
        },
      })),
      notes: [`there isn't any publish configuration`],
    }
  }

  const publishResult: Graph<{
    artifact: Artifact
    stepResult: PackageStepResult[StepName.publish]
  }> = await travelGraph(orderedGraph, {
    fromLeafs: true,
    mapData: async node => {
      const targetType = node.data.artifact.targetType

      if (!targetType) {
        return {
          artifact: node.data.artifact,
          stepResult: {
            stepName: StepName.publish,
            durationMs: Date.now() - startMs,
            status: StepStatus.skippedAsPassed,
            notes: ['skipping publish because this is a private-npm-package'],
          },
        }
      }

      if (!targetsInfo[targetType]?.shouldPublish) {
        return {
          artifact: node.data.artifact,
          stepResult: {
            stepName: StepName.publish,
            durationMs: Date.now() - startMs,
            status: StepStatus.skippedAsPassed,
            notes: [`ci is configured to skip publish for ${targetType} targets`],
          },
        }
      }

      if (!node.data.artifact.publishInfo) {
        return {
          artifact: node.data.artifact,
          stepResult: {
            stepName: StepName.publish,
            durationMs: Date.now() - startMs,
            status: StepStatus.skippedAsPassed,
            notes: [`there isn't any publish configuration for ${targetType} targets`],
          },
        }
      }

      if (node.data.artifact.publishInfo.needPublish !== true) {
        return {
          artifact: node.data.artifact,
          stepResult: {
            stepName: StepName.publish,
            durationMs: Date.now() - startMs,
            status: StepStatus.skippedAsPassed,
            notes: [`this package was already published with the same content`],
            publishedVersion: node.data.artifact.publishInfo.needPublish.alreadyPublishedAsVersion,
          },
        }
      }

      const didTestStepFailed = [
        StepStatus.failed,
        StepStatus.skippedAsFailed,
        StepStatus.skippedAsFailedBecauseLastStepFailed,
      ].includes(node.data.stepResult.status)

      if (didTestStepFailed) {
        return {
          artifact: node.data.artifact,
          stepResult: {
            stepName: StepName.publish,
            durationMs: Date.now() - startMs,
            status: StepStatus.skippedAsFailedBecauseLastStepFailed,
            notes: ['skipping publish because the tests of this package failed'],
          },
        }
      }

      switch (targetType) {
        case TargetType.npm: {
          const publishResult = await publishNpm({
            artifact: node.data.artifact,
            newVersion: node.data.artifact.publishInfo.newVersion,
            setAsPublishedCache: cache.publish?.npm?.setAsPublished!,
            targetPublishInfo: targetsInfo.npm!,
          })
          return {
            artifact: node.data.artifact,
            stepResult: publishResult,
          }
        }
        case TargetType.docker: {
          const publishResult = await publishDocker({
            artifact: node.data.artifact,
            newVersion: node.data.artifact.publishInfo.newVersion,
            repoPath: repoPath,
            setAsPublishedCache: cache.publish?.docker?.setAsPublished!,
            targetPublishInfo: targetsInfo.docker!,
          })
          return {
            artifact: node.data.artifact,
            stepResult: publishResult,
          }
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
    executionOrder: executionOrder,
    status: calculateCombinedStatus(publishResult.map(node => node.data.stepResult.status)),
    packagesResult: publishResult,
    notes: [],
  }
}
