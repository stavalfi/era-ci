import {
  skipIfArtifactStepResultMissingOrFailedInCacheConstrain,
  skipIfArtifactTargetTypeNotSupportedConstrain,
} from 'constrains/src'
import { ConstrainResultType, createStep, createStepExperimental, Log, runConstrains, RunStrategy } from '@tahini/core'
import { skipIfStepIsDisabledConstrain } from '@tahini/constrains'
import { LocalSequentalTaskQueue } from '@tahini/task-queues'
import {
  buildFullDockerImageName,
  execaCommand,
  ExecutionStatus,
  Status,
  setPackageVersion,
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

export const dockerPublish = createStepExperimental<LocalSequentalTaskQueue, LocalDockerPublishConfiguration>({
  stepName: 'docker-publish',
  taskQueueClass: LocalSequentalTaskQueue,
  run: async options => {
    const constrainsResult = await runConstrains({
      options,
      constrains: [skipIfStepIsDisabledConstrain()],
      artifactConstrains: [
        currentArtifact => skipIfImageTagAlreadyPublishedConstrain({ currentArtifact }),
        currentArtifact =>
          skipIfArtifactTargetTypeNotSupportedConstrain({
            currentArtifact,
            supportedTargetType: TargetType.docker,
          }),
        currentArtifact =>
          skipIfArtifactStepResultMissingOrFailedInCacheConstrain({
            currentArtifact,
            stepNameToSearchInCache: 'build',
            skipAsFailedIfStepNotFoundInCache: true,
            skipAsPassedIfStepNotExists: true,
          }),
        currentArtifact =>
          skipIfArtifactStepResultMissingOrFailedInCacheConstrain({
            currentArtifact,
            stepNameToSearchInCache: 'test',
            skipAsFailedIfStepNotFoundInCache: true,
            skipAsPassedIfStepNotExists: true,
          }),
      ],
    })

    if (constrainsResult.constrainResultType === ConstrainResultType.shouldSkip) {
      return constrainsResult.result
    }

    const { stepConfigurations, repoPath, log, immutableCache, artifacts } = options

    dockerRegistryLogin({
      dockerRegistry: stepConfigurations.registry,
      registryAuth: stepConfigurations.registryAuth,
      repoPath,
      log,
    })

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

    return {
      errors: [],
      notes: [`published: "${fullImageNameNewVersion}"`],
      executionStatus: ExecutionStatus.done,
      status: Status.passed,
    }
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
    runStepOnArtifact: async ({ currentArtifact, stepConfigurations, repoPath, log, immutableCache }) => {},
  },
})
