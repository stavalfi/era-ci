import {
  createArtifactStepConstrain,
  createStep,
  Log,
  RunStrategy,
  skipIfArtifactStepResultMissingOrFailedInCacheConstrain,
  skipIfStepIsDisabledConstrain,
} from '@tahini/core'
import {
  buildFullDockerImageName,
  ConstrainResult,
  execaCommand,
  ExecutionStatus,
  PackageJson,
  Status,
} from '@tahini/utils'
import _ from 'lodash'
import semver from 'semver'
import { calculateNewVersion, getPackageTargetType, setPackageVersion, TargetType } from './utils'
import { LocalSequentalTaskQueue } from '@tahini/task-queues'

export type DockerPublishConfiguration = {
  isStepEnabled: boolean
  registry: string
  registryAuth?: {
    username: string
    token: string
  }
  dockerOrganizationName: string
  remoteSshDockerHost?: string
}

export const fullImageNameCacheKey = ({ packageHash }: { packageHash: string }): string =>
  `full_image_name_of_artifact_hash-${packageHash}`

const getVersionCacheKey = ({ artifactHash }: { artifactHash: string }) => `${artifactHash}-docker-version`

async function runSkopeoCommand(
  command: string | [string, ...Array<string>],
  repoPath: string,
  log: Log,
): Promise<string> {
  const { stdout: result } = await execaCommand(command, { cwd: repoPath, stdio: 'pipe', log })
  return result
}

async function dockerRegistryLogin({
  repoPath,
  dockerRegistry,
  log,
  registryAuth,
}: {
  repoPath: string
  dockerRegistry: string
  registryAuth?: {
    username: string
    token: string
  }
  log: Log
}) {
  if (registryAuth?.username && registryAuth.username) {
    log.verbose(`logging in to docker-registry: ${dockerRegistry}`)
    // I need to login to read and push from `dockerRegistryUsername` repository
    await execaCommand(
      ['docker', 'login', '--username', registryAuth.username, '--password', registryAuth.token, dockerRegistry],
      {
        stdio: 'pipe',
        shell: true,
        cwd: repoPath,
        log,
      },
    )
    log.verbose(`logged in to docker-registry: "${dockerRegistry}"`)
  }
}

async function isDockerVersionAlreadyPulished({
  packageName,
  imageTag,
  dockerOrganizationName,
  dockerRegistry,
  repoPath,
  log,
  registryAuth,
}: {
  packageName: string
  imageTag: string
  dockerRegistry: string
  dockerOrganizationName: string
  repoPath: string
  registryAuth?: {
    username: string
    token: string
  }
  log: Log
}) {
  const fullImageName = buildFullDockerImageName({
    dockerOrganizationName,
    dockerRegistry,
    imageName: packageName,
    imageTag,
  })
  const withAuth = registryAuth ? `--creds ${registryAuth.username}:${registryAuth.token}` : ''
  try {
    await runSkopeoCommand(
      `skopeo inspect ${withAuth} ${
        dockerRegistry.includes('http://') ? '--tls-verify=false' : ''
      } docker://${fullImageName}`,
      repoPath,
      log,
    )
    return true
  } catch (e) {
    if (
      e.stderr?.includes('manifest unknown') ||
      e.stderr?.includes('unable to retrieve auth token') ||
      e.stderr?.includes('invalid status code from registry 404 (Not Found)')
    ) {
      return false
    } else {
      throw e
    }
  }
}

function getHighestDockerTag(tags: Array<string>): string | undefined {
  const sorted = semver.sort(tags.filter((tag: string) => semver.valid(tag)))
  if (sorted.length > 0) {
    return sorted[sorted.length - 1]
  }
}

/*
todo: remove skopeo and use docker v2 api. it's not working when trying to use the following commands with unsecure-local-registry

#!/usr/bin/env bash
repo=stavalfi/simple-service                                                                                                                                                                              
token=$(curl -s "https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repo}:pull" | jq -r '.token')
digest=$(curl -s -H "Accept: application/vnd.docker.distribution.manifest.v2+json" -H "Authorization: Bearer $token" "https://registry-1.docker.io/v2/${repo}/manifests/latest" | jq .config.digest -r)
curl -s -L -H "Accept: application/vnd.docker.distribution.manifest.v2+json" -H "Authorization: Bearer $token" "https://registry-1.docker.io/v2/${repo}/blobs/$digest" | jq .config.Labels
*/
export async function getDockerImageLabelsAndTags({
  packageJsonName,
  dockerOrganizationName,
  dockerRegistry,
  silent,
  repoPath,
  log,
  registryAuth,
}: {
  packageJsonName: string
  dockerOrganizationName: string
  dockerRegistry: string
  silent?: boolean
  repoPath: string
  log: Log
  registryAuth?: {
    username: string
    token: string
  }
}): Promise<{ latestHash?: string; latestTag?: string; allTags: Array<string> } | undefined> {
  const fullImageNameWithoutTag = buildFullDockerImageName({
    dockerOrganizationName,
    dockerRegistry,
    imageName: packageJsonName,
  })
  const withAuth = registryAuth ? `--creds ${registryAuth.username}:${registryAuth.token}` : ''

  try {
    if (!silent) {
      log.verbose(`searching for all tags for image: "${fullImageNameWithoutTag}"`)
    }
    const tagsResult = await runSkopeoCommand(
      `skopeo list-tags ${withAuth} ${
        dockerRegistry.includes('http://') ? '--tls-verify=false' : ''
      } docker://${fullImageNameWithoutTag}`,
      repoPath,
      log,
    )
    const tagsResultJson = JSON.parse(tagsResult || '{}')
    const allTags = tagsResultJson?.Tags || []

    const highestPublishedTag = getHighestDockerTag(allTags)

    const fullImageName = buildFullDockerImageName({
      dockerOrganizationName,
      dockerRegistry,
      imageName: packageJsonName,
      imageTag: highestPublishedTag,
    })

    if (!silent) {
      log.verbose(`searching the latest tag and hash for image "${fullImageName}"`)
    }

    const stdout = await runSkopeoCommand(
      `skopeo inspect ${withAuth} ${
        dockerRegistry.includes('http://') ? '--tls-verify=false' : ''
      } docker://${fullImageName}`,
      repoPath,
      log,
    )

    const LabelsResult = JSON.parse(stdout)
    const labels = LabelsResult.Labels || {}

    if (!silent) {
      log.verbose(`labels of image "${fullImageName}": ${JSON.stringify(labels, null, 2)}`)
    }
    const result = {
      latestHash: labels['latest-hash'],
      latestTag: labels['latest-tag'],
      allTags,
    }

    if (!silent) {
      log.verbose(
        `latest tag and hash for "${fullImageName}" are: "${JSON.stringify(_.omit(result, ['allTags']), null, 2)}"`,
      )
      if (!result.latestHash || !result.latestTag) {
        log.verbose(
          `one of ${JSON.stringify(
            result,
            null,
            2,
          )} is falsy for image "${fullImageName}". maybe someone in your team manually did that or we have a bug. anyways we have a fall-back plan - don't worry.`,
        )
      }
    }
    return result
  } catch (e) {
    if (
      e.stderr?.includes('manifest unknown') ||
      e.stderr?.includes('unable to retrieve auth token') ||
      e.stderr?.includes('invalid status code from registry 404 (Not Found)')
    ) {
      if (!silent) {
        log.verbose(`"${fullImageNameWithoutTag}" weren't published before so we can't find this image`)
      }
    } else {
      throw e
    }
  }
}

async function calculateNextVersion({
  packageJson,
  dockerOrganizationName,
  dockerRegistry,
  packagePath,
  repoPath,
  log,
}: {
  packageJson: PackageJson
  dockerRegistry: string
  dockerOrganizationName: string
  packagePath: string
  repoPath: string
  log: Log
}): Promise<string> {
  const dockerLatestTagInfo = await getDockerImageLabelsAndTags({
    dockerRegistry,
    dockerOrganizationName,
    packageJsonName: packageJson.name,
    repoPath,
    log,
  })

  return calculateNewVersion({
    packagePath,
    packageJsonVersion: packageJson.version,
    highestPublishedVersion: dockerLatestTagInfo?.latestTag,
    allVersions: dockerLatestTagInfo?.allTags,
  })
}

const customConstrain = createArtifactStepConstrain<void, void, DockerPublishConfiguration>({
  constrainName: 'custom-constrain',
  constrain: async ({ currentArtifact, stepConfigurations, immutableCache, repoPath, log }) => {
    const targetType = await getPackageTargetType(
      currentArtifact.data.artifact.packagePath,
      currentArtifact.data.artifact.packageJson,
    )
    if (targetType !== TargetType.docker) {
      return {
        constrainResult: ConstrainResult.shouldSkip,
        artifactStepResult: {
          errors: [],
          notes: [],
          executionStatus: ExecutionStatus.aborted,
          status: Status.skippedAsPassed,
        },
      }
    }

    const dockerVersionResult = await immutableCache.get(
      getVersionCacheKey({ artifactHash: currentArtifact.data.artifact.packageHash }),
      r => {
        if (typeof r === 'string') {
          return r
        } else {
          throw new Error(
            `invalid value in cache. expected the type to be: string, acutal-type: ${typeof r}. actual value: ${r}`,
          )
        }
      },
    )

    if (!dockerVersionResult) {
      return {
        constrainResult: ConstrainResult.shouldRun,
        artifactStepResult: { errors: [], notes: [] },
      }
    }

    if (
      await isDockerVersionAlreadyPulished({
        dockerRegistry: stepConfigurations.registry,
        packageName: currentArtifact.data.artifact.packageJson.name,
        imageTag: dockerVersionResult.value,
        dockerOrganizationName: stepConfigurations.dockerOrganizationName,
        repoPath,
        log,
      })
    ) {
      return {
        constrainResult: ConstrainResult.shouldSkip,
        artifactStepResult: {
          errors: [],
          notes: [
            `this package was already published in flow: "${dockerVersionResult.flowId}" with the same content as version: ${dockerVersionResult.value}`,
          ],
          executionStatus: ExecutionStatus.aborted,
          status: Status.skippedAsPassed,
        },
      }
    }

    return {
      constrainResult: ConstrainResult.shouldRun,
      artifactStepResult: { errors: [], notes: [] },
    }
  },
})

export const dockerPublish = createStep<LocalSequentalTaskQueue, DockerPublishConfiguration>({
  stepName: 'docker-publish',
  taskQueueClass: LocalSequentalTaskQueue,
  constrains: {
    onArtifact: [
      skipIfArtifactStepResultMissingOrFailedInCacheConstrain({
        stepNameToSearchInCache: 'build',
        skipAsFailedIfStepNotFoundInCache: true,
      }),
      skipIfArtifactStepResultMissingOrFailedInCacheConstrain({
        stepNameToSearchInCache: 'test',
        skipAsFailedIfStepNotFoundInCache: true,
      }),
      customConstrain(),
    ],
    onStep: [skipIfStepIsDisabledConstrain()],
  },
  run: {
    runStrategy: RunStrategy.perArtifact,
    beforeAll: ({ stepConfigurations, repoPath, log }) =>
      dockerRegistryLogin({
        dockerRegistry: stepConfigurations.registry,
        registryAuth: stepConfigurations.registryAuth,
        repoPath,
        log,
      }),
    runStepOnArtifact: async ({ currentArtifact, stepConfigurations, repoPath, log, immutableCache }) => {
      const newVersion = await calculateNextVersion({
        dockerRegistry: stepConfigurations.registry,
        dockerOrganizationName: stepConfigurations.dockerOrganizationName,
        packageJson: currentArtifact.data.artifact.packageJson,
        packagePath: currentArtifact.data.artifact.packagePath,
        repoPath,
        log,
      })

      const fullImageNameNewVersion = buildFullDockerImageName({
        dockerOrganizationName: stepConfigurations.dockerOrganizationName,
        dockerRegistry: stepConfigurations.registry,
        imageName: currentArtifact.data.artifact.packageJson.name,
        imageTag: newVersion,
      })

      const fullImageNameCacheTtl = immutableCache.ttls.ArtifactStepResult

      await immutableCache.set({
        key: fullImageNameCacheKey({ packageHash: currentArtifact.data.artifact.packageHash }),
        value: fullImageNameNewVersion,
        ttl: fullImageNameCacheTtl,
      })

      log.info(
        `building docker image "${fullImageNameNewVersion}" in package: "${currentArtifact.data.artifact.packageJson.name}"`,
      )

      await setPackageVersion({
        artifact: currentArtifact.data.artifact,
        fromVersion: currentArtifact.data.artifact.packageJson.version,
        toVersion: newVersion,
      })

      await execaCommand(
        `docker build --label latest-hash=${currentArtifact.data.artifact.packageHash} --label latest-tag=${newVersion} -f Dockerfile -t ${fullImageNameNewVersion} ${repoPath}`,
        {
          cwd: currentArtifact.data.artifact.packagePath,
          stdio: 'inherit',
          env: {
            // eslint-disable-next-line no-process-env
            ...(stepConfigurations.remoteSshDockerHost && { DOCKER_HOST: stepConfigurations.remoteSshDockerHost }),
          },
          log,
        },
      )

      // revert version to what it was before we changed it
      await setPackageVersion({
        artifact: currentArtifact.data.artifact,
        fromVersion: newVersion,
        toVersion: currentArtifact.data.artifact.packageJson.version,
      }).catch(e => {
        log.error(`could not revert the package-version in package.json but the flow won't fail because of that`, e)
      })

      log.info(
        `built docker image "${fullImageNameNewVersion}" in package: "${currentArtifact.data.artifact.packageJson.name}"`,
      )
      await execaCommand(`docker push ${fullImageNameNewVersion}`, {
        cwd: currentArtifact.data.artifact.packagePath,
        stdio: 'inherit',
        env: {
          // eslint-disable-next-line no-process-env
          ...(stepConfigurations.remoteSshDockerHost && { DOCKER_HOST: stepConfigurations.remoteSshDockerHost }),
        },
        log,
      })

      await immutableCache.set({
        key: getVersionCacheKey({ artifactHash: currentArtifact.data.artifact.packageHash }),
        value: newVersion,
        ttl: immutableCache.ttls.ArtifactStepResult,
      })

      log.info(
        `published docker image "${fullImageNameNewVersion}" in package: "${currentArtifact.data.artifact.packageJson.name}"`,
      )

      await execaCommand(`docker rmi ${fullImageNameNewVersion}`, {
        stdio: 'pipe',
        env: {
          // eslint-disable-next-line no-process-env
          ...(stepConfigurations.remoteSshDockerHost && { DOCKER_HOST: stepConfigurations.remoteSshDockerHost }),
        },
        cwd: repoPath,
        log,
      }).catch(e =>
        log.error(
          `couldn't remove image: "${fullImageNameNewVersion}" after pushing it. this failure won't fail the build.`,
          e,
        ),
      )

      return {
        errors: [],
        notes: [`published: "${fullImageNameNewVersion}"`],
        executionStatus: ExecutionStatus.done,
        status: Status.passed,
      }
    },
  },
})
