import {
  skipIfArtifactStepResultMissingOrFailedInCacheConstrain,
  skipIfArtifactTargetTypeNotSupportedConstrain,
  skipIfStepIsDisabledConstrain,
} from '@era-ci/constrains'
import { createStepExperimental, Log, UserRunStepOptions } from '@era-ci/core'
import { LocalSequentalTaskQueue } from '@era-ci/task-queues'
import {
  Artifact,
  buildFullDockerImageName,
  execaCommand,
  ExecutionStatus,
  Node,
  Status,
  TargetType,
} from '@era-ci/utils'
import { LocalDockerPublishConfiguration } from './types'
import { chooseTagAndPublish } from './utils'

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
  currentArtifact,
  tag,
}: UserRunStepOptions<LocalSequentalTaskQueue, LocalDockerPublishConfiguration> & {
  currentArtifact: Node<{ artifact: Artifact }>
  tag: string
}): Promise<string> {
  const fullImageNameNewVersion = buildFullDockerImageName({
    dockerOrganizationName: stepConfigurations.dockerOrganizationName,
    dockerRegistry: stepConfigurations.registry,
    imageName: currentArtifact.data.artifact.packageJson.name,
    imageTag: tag,
  })

  log.info(
    `building docker image "${fullImageNameNewVersion}" in package: "${currentArtifact.data.artifact.packageJson.name}"`,
  )

  await execaCommand(
    `docker build --build-arg new_version=${tag} -f Dockerfile -t ${fullImageNameNewVersion} ${repoPath}`,
    {
      cwd: currentArtifact.data.artifact.packagePath,
      stdio: 'inherit',
      env: {
        ...(stepConfigurations.remoteSshDockerHost && { DOCKER_HOST: stepConfigurations.remoteSshDockerHost }),
        DOCKER_BUILDKIT: '1',
      },
      log,
    },
  )

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

  log.info(
    `published docker image "${fullImageNameNewVersion}" in package: "${currentArtifact.data.artifact.packageJson.name}"`,
  )

  await execaCommand(`docker rmi ${fullImageNameNewVersion}`, {
    stdio: 'pipe',
    env: {
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
  stepGroup: 'docker-publish',
  taskQueueClass: LocalSequentalTaskQueue,
  run: options => ({
    globalConstrains: [skipIfStepIsDisabledConstrain()],
    waitUntilArtifactParentsFinishedParentSteps: options.stepConfigurations.imageInstallArtifactsFromNpmRegistry,
    artifactConstrains: [
      artifact =>
        skipIfArtifactTargetTypeNotSupportedConstrain({
          currentArtifact: artifact,
          supportedTargetType: TargetType.docker,
        }),
      artifact =>
        skipIfArtifactStepResultMissingOrFailedInCacheConstrain({
          currentArtifact: artifact,
          stepNameToSearchInCache: 'build-root',
          skipAsPassedIfStepNotExists: true,
        }),
      artifact =>
        skipIfArtifactStepResultMissingOrFailedInCacheConstrain({
          currentArtifact: artifact,
          stepNameToSearchInCache: 'test',
          skipAsPassedIfStepNotExists: true,
        }),
      artifact =>
        skipIfArtifactStepResultMissingOrFailedInCacheConstrain({
          currentArtifact: artifact,
          stepNameToSearchInCache: 'validate-packages',
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
    onArtifact: async ({ artifact }) =>
      chooseTagAndPublish({
        ...options,
        artifact,
        publish: async tag => {
          const fullImageNameWithTag = await publishPackage({
            ...options,
            currentArtifact: artifact,
            tag,
          })
          return {
            executionStatus: ExecutionStatus.done,
            status: Status.passed,
            errors: [],
            notes: [`published docker-image: "${fullImageNameWithTag}"`],
            returnValue: fullImageNameWithTag,
          }
        },
      }),
  }),
})
