import {
  skipIfArtifactStepResultMissingOrFailedInCacheConstrain,
  skipIfArtifactTargetTypeNotSupportedConstrain,
  skipIfStepIsDisabledConstrain,
} from '@tahini/constrains'
import { createStepExperimental, Log, UserRunStepOptions } from '@tahini/core'
import { LocalSequentalTaskQueue } from '@tahini/task-queues'
import {
  Artifact,
  buildFullDockerImageName,
  execaCommand,
  ExecutionStatus,
  Node,
  setPackageVersion,
  Status,
  TargetType,
} from '@tahini/utils'
import { skipIfImageTagAlreadyPublishedConstrain } from './constrains'
import { LocalDockerPublishConfiguration } from './types'
import { calculateNextVersion, fullImageNameCacheKey, getVersionCacheKey } from './utils'

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

async function publishPackage({
  stepConfigurations,
  repoPath,
  log,
  immutableCache,
  currentArtifact,
}: UserRunStepOptions<LocalSequentalTaskQueue, LocalDockerPublishConfiguration> & {
  currentArtifact: Node<{ artifact: Artifact }>
}): Promise<string> {
  const newVersion = await calculateNextVersion({
    dockerRegistry: stepConfigurations.registry,
    dockerOrganizationName: stepConfigurations.dockerOrganizationName,
    packageJson: currentArtifact.data.artifact.packageJson,
    packagePath: currentArtifact.data.artifact.packagePath,
    repoPath,
    log,
    imageName: currentArtifact.data.artifact.packageJson.name,
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

  return fullImageNameNewVersion
}

export const dockerPublish = createStepExperimental<LocalSequentalTaskQueue, LocalDockerPublishConfiguration>({
  stepName: 'docker-publish',
  taskQueueClass: LocalSequentalTaskQueue,
  run: options => ({
    globalConstrains: [skipIfStepIsDisabledConstrain()],
    artifactConstrains: [
      artifact => skipIfImageTagAlreadyPublishedConstrain({ currentArtifact: artifact }),
      artifact =>
        skipIfArtifactTargetTypeNotSupportedConstrain({
          currentArtifact: artifact,
          supportedTargetType: TargetType.docker,
        }),
      artifact =>
        skipIfArtifactStepResultMissingOrFailedInCacheConstrain({
          currentArtifact: artifact,
          stepNameToSearchInCache: 'build-root',
          skipAsFailedIfStepResultNotFoundInCache: false,
          skipAsPassedIfStepNotExists: true,
        }),
      artifact =>
        skipIfArtifactStepResultMissingOrFailedInCacheConstrain({
          currentArtifact: artifact,
          stepNameToSearchInCache: 'test',
          skipAsFailedIfStepResultNotFoundInCache: false,
          skipAsPassedIfStepNotExists: true,
        }),
    ],
    onBeforeArtifacts: async () =>
      dockerRegistryLogin({
        dockerRegistry: options.stepConfigurations.registry,
        registryAuth: options.stepConfigurations.registryAuth,
        repoPath: options.repoPath,
        log: options.log,
      }),
    onArtifact: async ({ artifact }) => {
      const fullImageNameNewVersion = await publishPackage({ ...options, currentArtifact: artifact })
      return {
        executionStatus: ExecutionStatus.done,
        status: Status.passed,
        notes: [`published: "${fullImageNameNewVersion}"`],
      }
    },
  }),
})
