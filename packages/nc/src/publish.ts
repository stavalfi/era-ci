import { logger } from '@tahini/log'
import execa from 'execa'
import fse from 'fs-extra'
import isIp from 'is-ip'
import path from 'path'
import { buildFullDockerImageName } from './docker-utils'
import {
  Artifact,
  Cache,
  Graph,
  Node,
  PackagesStepResult,
  PackageStepResult,
  PublishCache,
  StepName,
  StepStatus,
  TargetInfo,
  TargetsInfo,
  TargetType,
} from './types'
import { calculateCombinedStatus } from './utils'

const log = logger('publish')

async function updateVersionAndPublish({
  tryPublish,
  newVersion,
  artifact,
  startMs,
  setAsPublishedCache,
  setAsFailedCache,
}: {
  artifact: Artifact
  newVersion: string
  tryPublish: () => Promise<PackageStepResult[StepName.publish]>
  setAsPublishedCache: PublishCache['setAsPublished']
  setAsFailedCache: PublishCache['setAsFailed']
  startMs: number
}): Promise<PackageStepResult[StepName.publish]> {
  const setPackageVersion = async (fromVersion: string | undefined, toVersion: string) => {
    const packageJsonPath = path.join(artifact.packagePath, 'package.json')
    if (!fromVersion) {
      throw new Error(
        `package.json: ${packageJsonPath} must have a version property. set it up to any valid version you want. for example: "1.0.0"`,
      )
    }
    const packageJsonAsString = await fse.readFile(packageJsonPath, 'utf-8')
    const from = `"version": "${fromVersion}"`
    const to = `"version": "${toVersion}"`
    if (packageJsonAsString.includes(from)) {
      const updatedPackageJson = packageJsonAsString.replace(from, to)
      await fse.writeFile(packageJsonPath, updatedPackageJson, 'utf-8')
    } else {
      throw new Error(
        `could not find the following substring in package.json: '${from}'. is there any missing/extra spaces? package.json as string: ${packageJsonAsString}`,
      )
    }
  }
  try {
    await setPackageVersion(artifact.packageJson.version, newVersion)
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
    await setAsPublishedCache(artifact.packageJson.name as string, artifact.packageHash, newVersion)
  } catch (error) {
    await setAsFailedCache(artifact.packageJson.name as string, artifact.packageHash)
    return {
      stepName: StepName.publish,
      durationMs: Date.now() - startMs,
      status: StepStatus.failed,
      notes: ['publish failed'],
      error,
    }
  }

  await setPackageVersion(newVersion, artifact.packageJson.version!).catch((error) => {
    log.error(`failed to revert package.json back to the old version`, error)
    // log and ignore this error.
  })

  return result
}

async function publishNpm<DeploymentClient>({
  newVersion,
  artifact,
  setAsPublishedCache,
  setAsFailedCache,
  targetPublishInfo,
}: {
  artifact: Artifact
  newVersion: string
  setAsPublishedCache: PublishCache['setAsPublished']
  setAsFailedCache: PublishCache['setAsFailed']
  targetPublishInfo: TargetInfo<TargetType.npm, DeploymentClient>
}): Promise<PackageStepResult[StepName.publish]> {
  const startMs = Date.now()

  log.verbose(`publishing npm target in package: "${artifact.packageJson.name}"`)

  const withPort =
    isIp.v4(targetPublishInfo.registry.host) || targetPublishInfo.registry.host === 'localhost'
      ? `:${targetPublishInfo.registry.port}`
      : ''
  const npmRegistryAddress = `${targetPublishInfo.registry.protocol}://${targetPublishInfo.registry.host}${withPort}`

  return updateVersionAndPublish({
    startMs,
    newVersion,
    artifact,
    setAsFailedCache,
    setAsPublishedCache,
    tryPublish: async () => {
      await execa.command(
        `yarn publish --registry ${npmRegistryAddress} --non-interactive ${
          artifact.packageJson.name?.includes('@') ? `--access ${targetPublishInfo.npmScopeAccess}` : ''
        }`,
        {
          stdio: 'inherit',
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
  setAsFailedCache,
  targetPublishInfo,
}: {
  artifact: Artifact
  newVersion: string
  setAsPublishedCache: PublishCache['setAsPublished']
  setAsFailedCache: PublishCache['setAsFailed']
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

  // the package.json will probably copied to the image during the docker-build so we want to make sure the new version is in there
  return updateVersionAndPublish({
    startMs,
    artifact,
    newVersion,
    setAsFailedCache,
    setAsPublishedCache,
    tryPublish: async () => {
      log.info(`building docker image "${fullImageNameNewVersion}" in package: "${artifact.packageJson.name}"`)

      try {
        await execa.command(
          `docker build --label latest-hash=${artifact.packageHash} --label latest-tag=${newVersion} -f Dockerfile -t ${fullImageNameNewVersion} ${repoPath}`,
          {
            cwd: artifact.packagePath,
            stdio: 'inherit',
            env: {
              // eslint-disable-next-line no-process-env
              ...(process.env.REMOTE_SSH_DOCKER_HOST && { DOCKER_HOST: process.env.REMOTE_SSH_DOCKER_HOST }),
            },
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
        await execa.command(`docker push ${fullImageNameNewVersion}`, {
          cwd: artifact.packagePath,
          stdio: 'inherit',
          env: {
            // eslint-disable-next-line no-process-env
            ...(process.env.REMOTE_SSH_DOCKER_HOST && { DOCKER_HOST: process.env.REMOTE_SSH_DOCKER_HOST }),
          },
        })
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

      await execa
        .command(`docker rmi ${fullImageNameNewVersion}`, {
          stdio: 'pipe',
          env: {
            // eslint-disable-next-line no-process-env
            ...(process.env.REMOTE_SSH_DOCKER_HOST && { DOCKER_HOST: process.env.REMOTE_SSH_DOCKER_HOST }),
          },
        })
        .catch((e) =>
          log.error(
            `couldn't remove image: "${fullImageNameNewVersion}" after pushing it. this failure won't fail the build.`,
            e,
          ),
        )

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
  publishCache,
  executionOrder,
  orderedGraph,
  repoPath,
  targetsInfo,
}: {
  orderedGraph: Graph<{ artifact: Artifact; stepResult: PackageStepResult[StepName.test] }>
  targetsInfo?: TargetsInfo<DeploymentClient>
  repoPath: string
  publishCache: Cache['publish']
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
      packagesResult: orderedGraph.map((node) => ({
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

  const preparePublishNode = async (
    node: Node<{
      artifact: Artifact
      stepResult: PackageStepResult[StepName.test]
    }>,
  ): Promise<
    () => Promise<
      Node<{
        artifact: Artifact
        stepResult: PackageStepResult[StepName.publish]
      }>
    >
  > => {
    const targetType = node.data.artifact.targetType

    if (!targetType) {
      return async () => ({
        ...node,
        data: {
          artifact: node.data.artifact,
          stepResult: {
            stepName: StepName.publish,
            durationMs: Date.now() - startMs,
            status: StepStatus.skippedAsPassed,
            notes: ['skipping publish because this is a private-npm-package'],
          },
        },
      })
    }

    if (!targetsInfo[targetType]?.shouldPublish) {
      return async () => ({
        ...node,
        data: {
          artifact: node.data.artifact,
          stepResult: {
            stepName: StepName.publish,
            durationMs: Date.now() - startMs,
            status: StepStatus.skippedAsPassed,
            notes: [`ci is configured to skip publish for ${targetType} targets`],
          },
        },
      })
    }

    if (!node.data.artifact.publishInfo) {
      return async () => ({
        ...node,
        data: {
          artifact: node.data.artifact,
          stepResult: {
            stepName: StepName.publish,
            durationMs: Date.now() - startMs,
            status: StepStatus.skippedAsPassed,
            notes: [`there isn't any publish configuration for ${targetType} targets`],
          },
        },
      })
    }

    const didTestStepFailed = [
      StepStatus.failed,
      StepStatus.skippedAsFailed,
      StepStatus.skippedAsFailedBecauseLastStepFailed,
    ].includes(node.data.stepResult.status)

    if (didTestStepFailed) {
      return async () => ({
        ...node,
        data: {
          artifact: node.data.artifact,
          stepResult: {
            stepName: StepName.publish,
            durationMs: Date.now() - startMs,
            status: StepStatus.skippedAsFailedBecauseLastStepFailed,
            notes: ['skipping publish because the tests of this package failed'],
          },
        },
      })
    }

    const cache = publishCache[targetType]! // because `targetsInfo[targetType]` is truethy

    const isPublishRun = await cache.isPublishRun(node.data.artifact.packageJson.name!, node.data.artifact.packageHash)

    if (isPublishRun) {
      const result = await cache.isPublished(node.data.artifact.packageJson.name!, node.data.artifact.packageHash)
      if (!result.shouldPublish) {
        if (result.publishSucceed) {
          return async () => ({
            ...node,
            data: {
              artifact: node.data.artifact,
              stepResult: {
                stepName: StepName.publish,
                durationMs: Date.now() - startMs,
                status: StepStatus.skippedAsPassed,
                notes: [
                  `this package was already published with the same content as version: ${result.alreadyPublishedAsVersion}`,
                ],
                publishedVersion: result.alreadyPublishedAsVersion,
              },
            },
          })
        } else {
          return async () => ({
            ...node,
            data: {
              artifact: node.data.artifact,
              stepResult: {
                stepName: StepName.publish,
                durationMs: Date.now() - startMs,
                status: StepStatus.skippedAsFailed,
                notes: [result.failureReason],
              },
            },
          })
        }
      }
    }

    const publishInfo = node.data.artifact.publishInfo
    switch (targetType) {
      case TargetType.npm: {
        return async () => ({
          ...node,
          data: {
            artifact: node.data.artifact,
            stepResult: await publishNpm({
              artifact: node.data.artifact,
              newVersion: publishInfo.newVersionIfPublish,
              setAsPublishedCache: cache.setAsPublished,
              setAsFailedCache: cache.setAsFailed,
              targetPublishInfo: targetsInfo.npm!,
            }),
          },
        })
      }
      case TargetType.docker: {
        return async () => ({
          ...node,
          data: {
            artifact: node.data.artifact,
            stepResult: await publishDocker({
              artifact: node.data.artifact,
              newVersion: publishInfo.newVersionIfPublish,
              repoPath: repoPath,
              setAsPublishedCache: cache.setAsPublished,
              setAsFailedCache: cache.setAsFailed,
              targetPublishInfo: targetsInfo.docker!,
            }),
          },
        })
      }
    }
  }

  const prepare = await Promise.all(orderedGraph.map(preparePublishNode))

  const publishResult: Graph<{
    artifact: Artifact
    stepResult: PackageStepResult[StepName.publish]
  }> = []

  for (const resultFunc of prepare) {
    publishResult.push(await resultFunc())
  }

  const withError = publishResult.filter((result) => result.data.stepResult.error)
  if (withError.length > 0) {
    log.error(
      `the following packages had an error while publishing: ${withError
        .map((result) => result.data.artifact.packageJson.name)
        .join(', ')}`,
    )
    withError.forEach((result) => {
      log.error(`${result.data.artifact.packageJson.name}: `, result.data.stepResult.error)
    })
  }

  return {
    stepName: StepName.publish,
    durationMs: Date.now() - startMs,
    executionOrder: executionOrder,
    status: calculateCombinedStatus(publishResult.map((node) => node.data.stepResult.status)),
    packagesResult: publishResult,
    notes: [],
  }
}
