import {
  skipAsFailedIfArtifactStepResultFailedInCacheConstrain,
  skipAsPassedIfStepIsDisabledConstrain,
} from '@era-ci/constrains'
import { ConstrainResultType, createConstrain, createStep, Log } from '@era-ci/core'
import { LocalSequentalTaskQueue } from '@era-ci/task-queues'
import {
  Artifact,
  calculateNewVersion,
  determinePackageManager,
  execaCommand,
  ExecutionStatus,
  getPackageTargetTypes,
  Node,
  PackageJson,
  PackageManager,
  Status,
  TargetType,
} from '@era-ci/utils'
import chance from 'chance'
import execa from 'execa'
import fse from 'fs-extra'
import os from 'os'
import path from 'path'

export enum NpmScopeAccess {
  public = 'public',
  restricted = 'restricted',
}

export type NpmPublishConfiguration = {
  isStepEnabled: boolean
  registry: string
  npmScopeAccess: NpmScopeAccess
  registryAuth: {
    email: string
    username: string
    password: string
  }
}

const getVersionCacheKey = ({ artifactHash, artifactName }: { artifactHash: string; artifactName: string }) =>
  `npm-version-of-${artifactName}-${artifactHash}`

async function getNpmhighestVersionInfo({
  packageName,
  npmRegistry,
  repoPath,
  log,
}: {
  packageName: string
  npmRegistry: string
  repoPath: string
  log: Log
}): Promise<
  | {
      highestVersion?: string
      allVersions: Array<string>
    }
  | undefined
> {
  try {
    const command = `npm view ${packageName} --json --registry ${npmRegistry}`

    log.verbose(`searching the latest tag: "${command}"`)

    const result = await execaCommand(command, { cwd: repoPath, stdio: 'pipe', log })
    const resultJson = JSON.parse(result.stdout) || {}
    const allVersions: Array<string> = resultJson['versions'] || []
    const distTags = resultJson['dist-tags'] as { [key: string]: string }
    const highestVersion = distTags['latest']

    const latest = {
      highestVersion,
      allVersions,
    }
    log.verbose(`latest tag for "${packageName}" is: "${latest.highestVersion}"`)
    return latest
  } catch (e) {
    if (e.message.includes('code E404')) {
      log.verbose(`"${packageName}" weren't published`)
    } else {
      throw e
    }
  }
}

async function calculateNextNewVersion({
  packageJson,
  npmRegistry,
  packagePath,
  repoPath,
  log,
}: {
  packageJson: PackageJson
  npmRegistry: string
  packagePath: string
  repoPath: string
  log: Log
}): Promise<string> {
  const npmhighestVersionInfo = await getNpmhighestVersionInfo({
    packageName: packageJson.name,
    npmRegistry,
    repoPath,
    log,
  })
  return calculateNewVersion({
    packagePath,
    packageJsonVersion: packageJson.version,
    allPublishedVersions: npmhighestVersionInfo?.allVersions,
    log,
  })
}

async function isNpmVersionAlreadyPulished({
  npmRegistry,
  packageName,
  packageVersion,
  repoPath,
  log,
}: {
  packageName: string
  packageVersion: string
  npmRegistry: string
  repoPath: string
  log: Log
}) {
  const command = `npm view ${packageName}@${packageVersion} --json --registry ${npmRegistry}`
  try {
    const { stdout } = await execaCommand(command, { cwd: repoPath, stdio: 'pipe', log })
    return Boolean(stdout) // for some reaosn, if the version is not found, it doesn't throw an error. but the stdout is empty.
  } catch (e) {
    if (e.message.includes('code E404')) {
      return false
    } else {
      throw e
    }
  }
}

export async function npmRegistryLogin({
  npmRegistry,
  npmRegistryPassword,
  log,
  npmRegistryEmail,
  npmRegistryUsername,
}: {
  npmRegistry: string
  npmRegistryUsername: string
  npmRegistryEmail: string
  npmRegistryPassword: string
  log?: Log // it's optional for test purposes
}): Promise<void> {
  if (npmRegistry[npmRegistry.length - 1] === '/') {
    npmRegistry = npmRegistry.slice(0, npmRegistry.length - 1)
  }

  // https://verdaccio.org/docs/en/cli-registry#yarn-1x
  // yarn@1.x does not send the authorization header on yarn install if your packages requires authentication,
  // by enabling always-auth will force yarn do it on each request.
  await execa.command(`npm config set always-auth true `, {
    stdio: 'pipe',
  })

  await execa.command(require.resolve(`.bin/npm-login-noninteractive`), {
    stdio: 'pipe',
    env: {
      NPM_USER: npmRegistryUsername,
      NPM_PASS: npmRegistryPassword,
      NPM_EMAIL: npmRegistryEmail,
      NPM_REGISTRY: npmRegistry,
    },
  })
  log?.info(`logged in to npm-registry: "${npmRegistry}"`)
}

const customConstrain = createConstrain<
  { currentArtifact: Node<{ artifact: Artifact }> },
  { currentArtifact: Node<{ artifact: Artifact }> },
  NpmPublishConfiguration
>({
  constrainName: 'custom-constrain',
  constrain: async ({
    stepConfigurations,
    immutableCache,
    repoPath,
    log,
    constrainConfigurations: { currentArtifact },
  }) => {
    const targetTypes = await getPackageTargetTypes(
      currentArtifact.data.artifact.packagePath,
      currentArtifact.data.artifact.packageJson,
    )

    if (!targetTypes.includes(TargetType.npm)) {
      return {
        resultType: ConstrainResultType.shouldSkip,
        result: {
          errors: [],
          notes: [],
          executionStatus: ExecutionStatus.aborted,
          status: Status.skippedAsPassed,
        },
      }
    }

    const npmVersionResult = await immutableCache.get({
      key: getVersionCacheKey({
        artifactHash: currentArtifact.data.artifact.packageHash,
        artifactName: currentArtifact.data.artifact.packageJson.name,
      }),
      isBuffer: true,
      mapper: r => {
        if (typeof r === 'string') {
          return r
        } else {
          throw new Error(
            `invalid value in cache. expected the type to be: string, acutal-type: ${typeof r}. actual value: ${r}`,
          )
        }
      },
    })

    if (!npmVersionResult) {
      return {
        resultType: ConstrainResultType.ignoreThisConstrain,
        result: { errors: [], notes: [] },
      }
    }

    await npmRegistryLogin({
      npmRegistry: stepConfigurations.registry,
      npmRegistryPassword: stepConfigurations.registryAuth.password,
      npmRegistryEmail: stepConfigurations.registryAuth.email,
      npmRegistryUsername: stepConfigurations.registryAuth.username,
      log,
    })

    if (
      await isNpmVersionAlreadyPulished({
        npmRegistry: stepConfigurations.registry,
        packageName: currentArtifact.data.artifact.packageJson.name,
        packageVersion: npmVersionResult.value,
        repoPath,
        log,
      })
    ) {
      return {
        resultType: ConstrainResultType.shouldSkip,
        result: {
          errors: [],
          notes: [
            `this package was already published in flow: "${npmVersionResult.flowId}" with the same content as version: ${npmVersionResult.value}`,
          ],
          executionStatus: ExecutionStatus.aborted,
          status: Status.skippedAsPassed,
        },
      }
    }

    return {
      resultType: ConstrainResultType.ignoreThisConstrain,
      result: { errors: [], notes: [] },
    }
  },
})

// TODO: each step also supported to work without other steps -> we need to verify this in tests
export const npmPublish = createStep<LocalSequentalTaskQueue, NpmPublishConfiguration>({
  stepName: 'npm-publish',
  stepGroup: 'npm-publish',
  taskQueueClass: LocalSequentalTaskQueue,
  run: async ({ stepConfigurations, repoPath, log, immutableCache, logger, processEnv }) => {
    return {
      globalConstrains: [skipAsPassedIfStepIsDisabledConstrain()],
      artifactConstrains: [
        artifact =>
          skipAsFailedIfArtifactStepResultFailedInCacheConstrain({
            currentArtifact: artifact,
            stepNameToSearchInCache: 'build-root',
            skipAsPassedIfStepNotExists: true,
          }),
        artifact =>
          skipAsFailedIfArtifactStepResultFailedInCacheConstrain({
            currentArtifact: artifact,
            stepNameToSearchInCache: 'test',
            skipAsPassedIfStepNotExists: true,
          }),
        artifact =>
          skipAsFailedIfArtifactStepResultFailedInCacheConstrain({
            currentArtifact: artifact,
            stepNameToSearchInCache: 'validate-packages',
            skipAsPassedIfStepNotExists: true,
          }),
        artifact =>
          skipAsFailedIfArtifactStepResultFailedInCacheConstrain({
            currentArtifact: artifact,
            stepNameToSearchInCache: 'install-root',
            skipAsPassedIfStepNotExists: true,
          }),
        artifact => customConstrain({ currentArtifact: artifact }),
      ],
      onBeforeArtifacts: () =>
        npmRegistryLogin({
          npmRegistry: stepConfigurations.registry,
          npmRegistryPassword: stepConfigurations.registryAuth.password,
          npmRegistryEmail: stepConfigurations.registryAuth.email,
          npmRegistryUsername: stepConfigurations.registryAuth.username,
          log,
        }),
      onArtifact: async ({ artifact }) => {
        const newVersion = await calculateNextNewVersion({
          npmRegistry: stepConfigurations.registry,
          packageJson: artifact.data.artifact.packageJson,
          packagePath: artifact.data.artifact.packagePath,
          repoPath,
          log,
        })

        log.info(`publishing npm target with new version: "${artifact.data.artifact.packageJson.name}@${newVersion}"`)

        // copy the package to different temp-dir on the OS because the publish phase
        // mutate the package.json and we don't want this while other steps are running right now.
        // USECASE: when quay-docker-publish runs, it will fail if the git-repo is dirty.

        const copiedPackagePathToPublish = path.join(
          os.tmpdir(),
          `copied-${artifact.data.artifact.packageJson.name}-${chance().hash().slice(0, 8)}`,
        )
        await fse.copy(artifact.data.artifact.packagePath, copiedPackagePathToPublish)
        const newPackageJsonPath = path.join(copiedPackagePathToPublish, 'package.json')
        await fse.writeJSON(newPackageJsonPath, { ...(await fse.readJSON(newPackageJsonPath)), version: newVersion })

        let publishCommand: string

        const withAcess = artifact.data.artifact.packageJson.name?.includes('@')
          ? `--access ${stepConfigurations.npmScopeAccess}`
          : ''

        switch (await determinePackageManager({ repoPath, processEnv })) {
          case PackageManager.yarn1: {
            publishCommand = `npm publish ${withAcess} --registry ${stepConfigurations.registry}`
            break
          }
          case PackageManager.yarn2: {
            // I'm not sure how to login and publish in yarn2: https://github.com/yarnpkg/berry/issues/2503
            // for now, we publish with npm
            publishCommand = `npm publish ${withAcess}`
            break
          }
        }

        await execaCommand(publishCommand, {
          stdio: 'pipe',
          cwd: copiedPackagePathToPublish,
          log,
        })
          .then(async () => {
            // wait (up to a 2 minutes) until the package is available
            for (let i = 0; i < 24; i++) {
              const npmhighestVersionInfo = await getNpmhighestVersionInfo({
                packageName: artifact.data.artifact.packageJson.name,
                npmRegistry: stepConfigurations.registry,
                repoPath,
                log: logger.createLog('wait-until-package-published', { disable: true }),
              })
              if (npmhighestVersionInfo?.highestVersion === newVersion) {
                break
              } else {
                if (i === 0) {
                  log.info(
                    `waiting until the npm-reigstry will confirm this publish: "${artifact.data.artifact.packageJson.name}@${newVersion}" (it may take few minutes)......`,
                  )
                }
                await new Promise(res => setTimeout(res, 5_000))
              }
            }
          })
          .then(() =>
            immutableCache.set({
              key: getVersionCacheKey({
                artifactHash: artifact.data.artifact.packageHash,
                artifactName: artifact.data.artifact.packageJson.name,
              }),
              value: newVersion,
              asBuffer: true,
              ttl: immutableCache.ttls.ArtifactStepResults,
            }),
          )

        log.info(`published npm target: "${artifact.data.artifact.packageJson.name}@${newVersion}"`)

        return {
          notes: [`published: "${artifact.data.artifact.packageJson.name}@${newVersion}"`],
          executionStatus: ExecutionStatus.done,
          status: Status.passed,
        }
      },
    }
  },
})
