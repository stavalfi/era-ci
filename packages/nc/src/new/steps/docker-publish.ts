import { buildFullDockerImageName, dockerRegistryLogin } from '../../docker-utils'
import { buildDockerTarget, getPackageTargetType } from '../../package-info'
import { execaCommand } from '../../utils'
import { createStep, StepStatus } from '../create-step'
import { getServerInfoFromRegistryAddress } from '../utils'
import { setPackageVersion, TargetType } from './utils'

export type DockerPublishConfiguration = {
  shouldPublish: boolean
  registry: string
  publishAuth: {
    username: string
    token: string
  }
  dockerOrganizationName: string
  fullImageNameCacheKey: (options: { packageHash: string }) => string
}

export const dockerPublish = createStep<DockerPublishConfiguration>({
  stepName: 'docker-publish',
  canRunStepOnArtifact: {
    customPredicate: async ({ currentArtifact, stepConfigurations, cache }) => {
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
            ...(process.env.REMOTE_SSH_DOCKER_HOST && { DOCKER_HOST: process.env.REMOTE_SSH_DOCKER_HOST }),
          },
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
        ...(process.env.REMOTE_SSH_DOCKER_HOST && { DOCKER_HOST: process.env.REMOTE_SSH_DOCKER_HOST }),
      },
    })

    log.info(
      `published docker image "${fullImageNameNewVersion}" in package: "${currentArtifact.data.artifact.packageJson.name}"`,
    )

    await execaCommand(`docker rmi ${fullImageNameNewVersion}`, {
      stdio: 'pipe',
      env: {
        // eslint-disable-next-line no-process-env
        ...(process.env.REMOTE_SSH_DOCKER_HOST && { DOCKER_HOST: process.env.REMOTE_SSH_DOCKER_HOST }),
      },
      cwd: repoPath,
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
