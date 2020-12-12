import {
  skipIfArtifactStepResultMissingOrFailedInCacheConstrain,
  skipIfArtifactTargetTypeNotSupportedConstrain,
  skipIfStepIsDisabledConstrain,
} from '@tahini/constrains'
import {
  ConstrainResultType,
  createStepExperimental,
  Log,
  StepEventType,
  StepInputEvents,
  StepOutputEvents,
  UserRunStepOptions,
} from '@tahini/core'
import { LocalSequentalTaskQueue } from '@tahini/task-queues'
import {
  Artifact,
  buildFullDockerImageName,
  concatMapOnce,
  execaCommand,
  ExecutionStatus,
  Node,
  setPackageVersion,
  Status,
  TargetType,
} from '@tahini/utils'
import { of } from 'rxjs'
import { mergeMap } from 'rxjs/operators'
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
  run: async options => {
    const constrainsResult = await options.runConstrains([skipIfStepIsDisabledConstrain()])

    if (constrainsResult.combinedResultType === ConstrainResultType.shouldSkip) {
      return of({
        type: StepEventType.step,
        stepResult: constrainsResult.combinedResult,
      })
    }

    return options.stepInputEvents$.pipe(
      concatMapOnce(
        e => e.type === StepEventType.artifactStep && e.artifactStepResult.executionStatus === ExecutionStatus.done,
        () =>
          dockerRegistryLogin({
            dockerRegistry: options.stepConfigurations.registry,
            registryAuth: options.stepConfigurations.registryAuth,
            repoPath: options.repoPath,
            log: options.log,
          }),
      ),
      mergeMap<StepInputEvents[StepEventType], Promise<StepOutputEvents[StepEventType]>>(async e => {
        if (e.type === StepEventType.artifactStep && e.artifactStepResult.executionStatus === ExecutionStatus.done) {
          const constrainsResult = await options.runConstrains([
            skipIfImageTagAlreadyPublishedConstrain({ currentArtifact: e.artifact }),
            skipIfArtifactTargetTypeNotSupportedConstrain({
              currentArtifact: e.artifact,
              supportedTargetType: TargetType.docker,
            }),
            skipIfArtifactStepResultMissingOrFailedInCacheConstrain({
              currentArtifact: e.artifact,
              stepNameToSearchInCache: 'build',
              skipAsFailedIfStepNotFoundInCache: true,
              skipAsPassedIfStepNotExists: true,
            }),
            skipIfArtifactStepResultMissingOrFailedInCacheConstrain({
              currentArtifact: e.artifact,
              stepNameToSearchInCache: 'test',
              skipAsFailedIfStepNotFoundInCache: true,
              skipAsPassedIfStepNotExists: true,
            }),
          ])

          if (constrainsResult.combinedResultType === ConstrainResultType.shouldSkip) {
            return {
              type: StepEventType.artifactStep,
              artifactName: e.artifact.data.artifact.packageJson.name,
              artifactStepResult: constrainsResult.combinedResult,
            }
          }

          const fullImageNameNewVersion = await publishPackage({ ...options, currentArtifact: e.artifact })

          return {
            type: StepEventType.artifactStep,
            artifactName: e.artifact.data.artifact.packageJson.name,
            artifactStepResult: {
              executionStatus: ExecutionStatus.done,
              status: Status.passed,
              notes: [`published: "${fullImageNameNewVersion}"`],
            },
          }
        } else {
          return e
        }
      }),
    )
  },
})
