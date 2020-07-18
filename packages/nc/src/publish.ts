import { logger } from '@tahini/log'
import execa from 'execa'
import isIp from 'is-ip'
import _ from 'lodash'
import { buildFullDockerImageName } from './docker-utils'
import {
  Auth,
  Graph,
  PackageInfo,
  PublishResult,
  ServerInfo,
  TargetInfo,
  TargetType,
  Cache,
  TestsResult,
  Node,
} from './types'
import { travelGraph } from './graph'

const log = logger('publish')

async function publishNpm({
  isDryRun,
  newVersion,
  npmTarget,
  packageInfo,
  testsResult,
  npmRegistry,
  cache,
  auth,
}: {
  packageInfo: PackageInfo
  npmTarget: TargetInfo<TargetType.npm>
  newVersion: string
  isDryRun: boolean
  testsResult: TestsResult
  npmRegistry: ServerInfo
  cache: Cache
  auth: Auth
}): Promise<PublishResult> {
  log.verbose(`publishing npm target in package: "${packageInfo.packageJson.name}"`)

  if ('passed' in testsResult && !testsResult.passed) {
    return {
      skipped: {
        reason: 'skipping publish because the tests failed',
      },
    }
  }

  if (npmTarget.needPublish !== true) {
    const publishedVersion = await cache.publish.npm.isPublished(
      packageInfo.packageJson.name as string,
      packageInfo.packageHash,
    )
    // it looks like someone manually published the promoted version before the ci publish it. all in all, the res
    return {
      skipped: {
        reason: npmTarget.needPublish.skip.reason,
      },
      ...(publishedVersion && {
        published: {
          asVersion: publishedVersion,
        },
      }),
    }
  }

  if (isDryRun) {
    return {
      skipped: { reason: `skipping publish because we are in dry-run mode` },
    }
  }

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

  const newVersionResult = await execa.command(`yarn version --new-version ${newVersion} --no-git-tag-version`, {
    stdio: 'ignore',
    cwd: packageInfo.packagePath,
    reject: false,
  })

  if (newVersionResult.failed) {
    return {
      skipped: false,
      published: {
        failed: { reason: `failed to set new version in package.json`, error: newVersionResult },
      },
    }
  }

  const publishResult = await execa.command(
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

  if (publishResult.failed) {
    return {
      skipped: false,
      published: {
        failed: { reason: `failed to pubilish`, error: newVersionResult },
      },
    }
  }

  log.info(`published npm target in package: "${packageInfo.packageJson.name}"`)

  return {
    skipped: false,
    published: {
      asVersion: newVersion,
    },
  }
}

async function publishDocker({
  repoPath,
  isDryRun,
  newVersion,
  dockerTarget,
  packageInfo,
  testsResult,
  dockerOrganizationName,
  dockerRegistry,
  cache,
}: {
  packageInfo: PackageInfo
  dockerTarget: TargetInfo<TargetType.docker>
  dockerRegistry: ServerInfo
  dockerOrganizationName: string
  newVersion: string
  testsResult: TestsResult
  isDryRun: boolean
  cache: Cache
  repoPath: string
}): Promise<PublishResult> {
  log.verbose('publishing docker target in package: "%s"', packageInfo.packageJson.name)

  if ('passed' in testsResult && !testsResult.passed) {
    return {
      skipped: {
        reason: 'skipping publish because the tests failed',
      },
    }
  }

  if (dockerTarget.needPublish !== true) {
    const publishedTag = await cache.publish.docker.isPublished(
      packageInfo.packageJson.name as string,
      packageInfo.packageHash,
    )
    return {
      skipped: {
        reason: dockerTarget.needPublish.skip.reason,
      },
      ...(publishedTag && {
        published: {
          asVersion: publishedTag,
        },
      }),
    }
  }

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
  const newVersionResult = await execa.command(`yarn version --new-version ${newVersion} --no-git-tag-version`, {
    stdio: 'ignore',
    cwd: packageInfo.packagePath,
    reject: false,
  })

  if (newVersionResult.failed) {
    return {
      skipped: false,
      published: {
        failed: { reason: `failed to set new version in package.json`, error: newVersionResult },
      },
    }
  }

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
      skipped: false,
      published: {
        failed: {
          reason: 'failed to build the docker-image',
          error,
        },
      },
    }
  }
  log.info(`built docker image "${fullImageNameNewVersion}" in package: "${packageInfo.packageJson.name}"`)

  if (isDryRun) {
    return {
      skipped: { reason: `skipping publish because we are in dry-run mode` },
    }
  }

  try {
    await execa.command(`docker push ${fullImageNameNewVersion}`)
  } catch (error) {
    return {
      skipped: false,
      published: {
        failed: { reason: `failed to push the docker-image`, error },
      },
    }
  }

  log.info(`published docker target in package: "${packageInfo.packageJson.name}"`)

  return {
    skipped: false,
    published: {
      asVersion: newVersion,
    },
  }
}

export async function publish(
  orderedGraph: Graph<PackageInfo & { testsResult: TestsResult }>,
  options: {
    repoPath: string
    isDryRun: boolean
    npmRegistry: ServerInfo
    dockerRegistry: ServerInfo
    dockerOrganizationName: string
    cache: Cache
    auth: Auth
  },
): Promise<Graph<PackageInfo & { testsResult: TestsResult; publishResult: PublishResult }>> {
  log.info('start publishing packages...')

  const publishResult = await travelGraph(orderedGraph, {
    fromLeafs: true,
    mapData: async node => {
      switch (node.data.target?.targetType) {
        case TargetType.npm: {
          return {
            ...node.data,
            publishResult: await publishNpm({
              packageInfo: node.data,
              npmTarget: node.data.target as TargetInfo<TargetType.npm>,
              newVersion: (node.data.target?.needPublish === true && node.data.target.newVersion) as string,
              isDryRun: options.isDryRun,
              testsResult: node.data.testsResult,
              npmRegistry: options.npmRegistry,
              auth: options.auth,
              cache: options.cache,
            }),
          }
        }
        case TargetType.docker:
          return {
            ...node.data,
            publishResult: await publishDocker({
              packageInfo: node.data,
              dockerTarget: node.data.target as TargetInfo<TargetType.docker>,
              newVersion: (node.data.target?.needPublish === true && node.data.target.newVersion) as string,
              repoPath: options.repoPath,
              isDryRun: options.isDryRun,
              testsResult: node.data.testsResult,
              dockerOrganizationName: options.dockerOrganizationName,
              dockerRegistry: options.dockerRegistry,
              cache: options.cache,
            }),
          }
        default:
          return {
            ...node.data,
            publishResult: {
              skipped: {
                reason: 'skipping publish because this is a private-npm-package',
              },
            },
          }
      }
    },
  })

  log.info('publish result: ')
  publishResult.forEach(node =>
    log.info(`${node.data.packagePath} - ${JSON.stringify(node.data.publishResult, null, 2)}`),
  )

  return publishResult
}
