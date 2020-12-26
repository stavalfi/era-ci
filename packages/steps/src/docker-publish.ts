import {
  skipIfArtifactStepResultMissingOrFailedInCacheConstrain,
  skipIfArtifactTargetTypeNotSupportedConstrain,
  skipIfStepIsDisabledConstrain,
} from '@tahini/constrains'
import { createStepExperimental, Log, UserReturnValue, UserRunStepOptions } from '@tahini/core'
import { addTagToRemoteImage, listTags } from '@tahini/image-registry-client'
import { LocalSequentalTaskQueue } from '@tahini/task-queues'
import {
  Artifact,
  buildFullDockerImageName,
  calculateNewVersion,
  execaCommand,
  ExecutionStatus,
  Node,
  setPackageVersion,
  Status,
  TargetType,
} from '@tahini/utils'
import { LocalDockerPublishConfiguration } from './types'

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
  const tags = await listTags({
    registry: stepConfigurations.registry,
    auth: stepConfigurations.registryAuth,
    dockerOrg: stepConfigurations.dockerOrganizationName,
    repo: currentArtifact.data.artifact.packageJson.name,
  })

  const newVersion = calculateNewVersion({
    packagePath: currentArtifact.data.artifact.packagePath,
    packageJsonVersion: currentArtifact.data.artifact.packageJson.version,
    allVersions: tags,
  })

  const fullImageNameNewVersion = buildFullDockerImageName({
    dockerOrganizationName: stepConfigurations.dockerOrganizationName,
    dockerRegistry: stepConfigurations.registry,
    imageName: currentArtifact.data.artifact.packageJson.name,
    imageTag: newVersion,
  })

  log.info(
    `building docker image "${fullImageNameNewVersion}" in package: "${currentArtifact.data.artifact.packageJson.name}"`,
  )

  await setPackageVersion({
    artifact: currentArtifact.data.artifact,
    fromVersion: currentArtifact.data.artifact.packageJson.version,
    toVersion: newVersion,
  })

  await execaCommand(`docker build -f Dockerfile -t ${fullImageNameNewVersion} ${repoPath}`, {
    cwd: currentArtifact.data.artifact.packagePath,
    stdio: 'inherit',
    env: {
      ...(stepConfigurations.remoteSshDockerHost && { DOCKER_HOST: stepConfigurations.remoteSshDockerHost }),
    },
    log,
  })

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
      const tags = await listTags({
        registry: options.stepConfigurations.registry,
        auth: options.stepConfigurations.registryAuth,
        dockerOrg: options.stepConfigurations.dockerOrganizationName,
        repo: artifact.data.artifact.packageJson.name,
      })

      const didHashPublished = tags.some(tag => tag === artifact.data.artifact.packageHash)
      const fullImageNameWithHashTag = (tag: string): string =>
        buildFullDockerImageName({
          dockerOrganizationName: options.stepConfigurations.dockerOrganizationName,
          dockerRegistry: options.stepConfigurations.registry,
          imageName: artifact.data.artifact.packageJson.name,
          imageTag: tag,
        })
      if (options.stepConfigurations.buildAndPushOnlyTempVersion) {
        if (didHashPublished) {
          return {
            executionStatus: ExecutionStatus.aborted,
            status: Status.skippedAsPassed,
            errors: [],
            notes: [`artifact already published: "${fullImageNameWithHashTag(artifact.data.artifact.packageHash)}"`],
          }
        } else {
          const fullImageNameNewVersion = await publishPackage({
            ...options,
            currentArtifact: artifact,
            tag: artifact.data.artifact.packageHash,
          })
          return {
            executionStatus: ExecutionStatus.done,
            status: Status.passed,
            notes: [`published: "${fullImageNameNewVersion}"`],
            returnValue: fullImageNameNewVersion,
          }
        }
      } else {
        const nextVersion = await options.immutableCache.get(
          `${artifact.data.artifact.packageHash}-next-semver-tag`,
          r => {
            if (typeof r !== 'string') {
              throw new Error(
                `bad value returned from redis-immutable-cache. expected image-tag, received: "${JSON.stringify(
                  r,
                  null,
                  2,
                )}"`,
              )
            } else {
              return r
            }
          },
        )
        if (nextVersion) {
          return {
            executionStatus: ExecutionStatus.aborted,
            status: Status.skippedAsPassed,
            errors: [],
            notes: [
              `artifact already published: "${fullImageNameWithHashTag(nextVersion.value)}" in flow: "${
                nextVersion.flowId
              }"`,
            ],
            returnValue: fullImageNameWithHashTag(nextVersion.value),
          }
        }

        let artifactStepResult: UserReturnValue
        const newTag = calculateNewVersion({
          packagePath: artifact.data.artifact.packagePath,
          packageJsonVersion: artifact.data.artifact.packageJson.version,
          allVersions: tags,
        })
        if (didHashPublished) {
          await addTagToRemoteImage({
            registry: options.stepConfigurations.registry,
            auth: options.stepConfigurations.registryAuth,
            dockerOrg: options.stepConfigurations.dockerOrganizationName,
            repo: artifact.data.artifact.packageJson.name,
            fromTag: artifact.data.artifact.packageHash,
            toTag: newTag,
          })
          artifactStepResult = {
            executionStatus: ExecutionStatus.done,
            status: Status.passed,
            errors: [],
            notes: [`artifact already published: "${fullImageNameWithHashTag(newTag)}"`],
            returnValue: fullImageNameWithHashTag(newTag),
          }
        } else {
          const fullImageNameNewVersion = await publishPackage({
            ...options,
            currentArtifact: artifact,
            tag: newTag,
          })
          artifactStepResult = {
            executionStatus: ExecutionStatus.done,
            status: Status.passed,
            errors: [],
            notes: [`artifact already published: "${fullImageNameNewVersion}"`],
            returnValue: fullImageNameNewVersion,
          }
        }
        await options.immutableCache.set({
          key: `${artifact.data.artifact.packageHash}-next-semver-tag`,
          value: newTag,
          ttl: options.immutableCache.ttls.ArtifactStepResult,
        })
        return artifactStepResult
      }
    },
  }),
})
