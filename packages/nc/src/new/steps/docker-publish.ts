import { buildFullDockerImageName, dockerRegistryLogin } from '../../docker-utils'
import { buildDockerTarget, getPackageTargetType } from '../../package-info'
import { ServerInfo } from '../../types'
import { execaCommand } from '../utils'
import { createStep, StepStatus } from '../create-step'
import { getServerInfoFromRegistryAddress } from '../utils'
import { setPackageVersion, TargetType } from './utils'
import { Log } from '../create-logger'

export type DockerPublishConfiguration = {
  shouldPublish: boolean
  registry: string
  publishAuth: {
    username: string
    token: string
  }
  dockerOrganizationName: string
  remoteSshDockerHost?: string
  fullImageNameCacheKey: (options: { packageHash: string }) => string
}

const getVersionCacheKey = ({ artifactHash }: { artifactHash: string }) => `${artifactHash}-docker-version`

async function runSkopeoCommand(command: string | [string, ...string[]], repoPath: string, log: Log): Promise<string> {
  const { stdout: result } = await execaCommand(command, { cwd: repoPath, stdio: 'pipe', log })
  return result
}

async function isDockerVersionAlreadyPulished({
  packageName,
  imageTag,
  dockerOrganizationName,
  dockerRegistry,
  repoPath,
  log,
}: {
  packageName: string
  imageTag: string
  dockerRegistry: ServerInfo
  dockerOrganizationName: string
  repoPath: string
  log: Log
}) {
  const fullImageName = buildFullDockerImageName({
    dockerOrganizationName,
    dockerRegistry,
    packageJsonName: packageName,
    imageTag,
  })
  try {
    await runSkopeoCommand(
      `skopeo inspect ${dockerRegistry.protocol === 'http' ? '--tls-verify=false' : ''} docker://${fullImageName}`,
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

export const dockerPublish = createStep<DockerPublishConfiguration>({
  stepName: 'docker-publish',
  canRunStepOnArtifact: {
    customPredicate: async ({ currentArtifact, stepConfigurations, cache, repoPath, log }) => {
      if (!stepConfigurations.shouldPublish) {
        return {
          canRun: false,
          notes: [`docker-publish is disabled`],
          stepStatus: StepStatus.skippedAsPassed,
        }
      }

      const targetType = await getPackageTargetType(
        currentArtifact.data.artifact.packagePath,
        currentArtifact.data.artifact.packageJson,
      )
      if (targetType !== TargetType.docker) {
        return {
          canRun: false,
          notes: [],
          stepStatus: StepStatus.skippedAsPassed,
        }
      }

      const dockerVersionResult = await cache.get(
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
          canRun: true,
          notes: [],
        }
      }

      if (
        await isDockerVersionAlreadyPulished({
          dockerRegistry: getServerInfoFromRegistryAddress(stepConfigurations.registry),
          packageName: currentArtifact.data.artifact.packageJson.name,
          imageTag: dockerVersionResult.value,
          dockerOrganizationName: stepConfigurations.dockerOrganizationName,
          repoPath,
          log,
        })
      ) {
        return {
          canRun: false,
          notes: [
            `this package was already published in flow: "${dockerVersionResult.flowId}" with the same content as version: ${dockerVersionResult.value}`,
          ],
          stepStatus: StepStatus.skippedAsPassed,
        }
      }

      return {
        canRun: true,
        notes: [],
      }
    },
  },
  beforeAll: ({ stepConfigurations, repoPath }) =>
    dockerRegistryLogin({
      dockerRegistry: getServerInfoFromRegistryAddress(stepConfigurations.registry),
      dockerRegistryToken: stepConfigurations.publishAuth.token,
      dockerRegistryUsername: stepConfigurations.publishAuth.username,
      repoPath,
    }),
  runStepOnArtifact: async ({ currentArtifact, stepConfigurations, repoPath, log, cache }) => {
    const dockerTarget = await buildDockerTarget({
      dockerRegistry: getServerInfoFromRegistryAddress(stepConfigurations.registry),
      dockerOrganizationName: stepConfigurations.dockerOrganizationName,
      publishAuth: stepConfigurations.publishAuth,
      packageJson: currentArtifact.data.artifact.packageJson,
      packagePath: currentArtifact.data.artifact.packagePath,
      repoPath,
    })

    const fullImageNameNewVersion = buildFullDockerImageName({
      dockerOrganizationName: stepConfigurations.dockerOrganizationName,
      dockerRegistry: getServerInfoFromRegistryAddress(stepConfigurations.registry),
      packageJsonName: currentArtifact.data.artifact.packageJson.name!,
      imageTag: dockerTarget.newVersionIfPublish,
    })

    const fullImageNameCacheTtl = cache.ttls.stepResult

    await cache.set(
      stepConfigurations.fullImageNameCacheKey({ packageHash: currentArtifact.data.artifact.packageHash }),
      fullImageNameNewVersion,
      fullImageNameCacheTtl,
    )

    log.info(
      `building docker image "${fullImageNameNewVersion}" in package: "${currentArtifact.data.artifact.packageJson.name}"`,
    )

    await setPackageVersion({
      artifact: currentArtifact.data.artifact,
      toVersion: dockerTarget.newVersionIfPublish,
    })

    try {
      await execaCommand(
        `docker build --label latest-hash=${currentArtifact.data.artifact.packageHash} --label latest-tag=${dockerTarget.newVersionIfPublish} -f Dockerfile -t ${fullImageNameNewVersion} ${repoPath}`,
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
    } catch (error) {
      // revert version to what it was before we changed it
      await setPackageVersion({
        artifact: currentArtifact.data.artifact,
        toVersion: currentArtifact.data.artifact.packageJson.version!,
      })
      throw error
    }

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

    await cache.set(
      getVersionCacheKey({ artifactHash: currentArtifact.data.artifact.packageHash }),
      dockerTarget.newVersionIfPublish,
      cache.ttls.stepResult,
    )

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
      notes: [],
      status: StepStatus.passed,
    }
  },
})
