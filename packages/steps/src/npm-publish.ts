import {
  skipIfArtifactStepResultMissingOrFailedInCacheConstrain,
  skipIfStepIsDisabledConstrain,
} from '@era-ci/constrains'
import { ConstrainResultType, createConstrain, createStepExperimental, Log } from '@era-ci/core'
import { LocalSequentalTaskQueue } from '@era-ci/task-queues'
import {
  Artifact,
  calculateNewVersion,
  execaCommand,
  ExecutionStatus,
  getPackageTargetTypes,
  Node,
  PackageJson,
  setPackageVersion,
  Status,
  TargetType,
} from '@era-ci/utils'
import execa from 'execa'
import _ from 'lodash'

export enum NpmScopeAccess {
  public = 'public',
  restricted = 'restricted',
}

export type NpmPublishConfiguration = {
  isStepEnabled: boolean
  registry: string
  npmScopeAccess: NpmScopeAccess
  publishAuth: {
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
    log.verbose(`searching the latest tag and hash: "${command}"`)
    const result = await execaCommand(command, { cwd: repoPath, stdio: 'pipe', log })
    const resultJson = JSON.parse(result.stdout) || {}
    const allVersions: Array<string> = resultJson['versions'] || []
    const distTags = resultJson['dist-tags'] as { [key: string]: string }
    const highestVersion = distTags['latest']

    const latest = {
      highestVersion,
      allVersions,
    }
    log.verbose(
      `latest tag and hash for "${packageName}" are: "${JSON.stringify(_.omit(latest, ['allVersions']), null, 2)}"`,
    )
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
  repoPath,
}: {
  npmRegistry: string
  npmRegistryUsername: string
  npmRegistryEmail: string
  npmRegistryPassword: string
  log: Log
  repoPath: string
}): Promise<void> {
  if (npmRegistry[npmRegistry.length - 1] === '/') {
    npmRegistry = npmRegistry.slice(0, npmRegistry.length - 1)
  }
  // in tests/local-mock runs, we login to the npm-registry (verdaccio) in a different way:
  await execa.command(require.resolve(`.bin/npm-login-noninteractive`), {
    stdio: 'ignore',
    cwd: repoPath,
    env: {
      NPM_USER: npmRegistryUsername,
      NPM_PASS: npmRegistryPassword,
      NPM_EMAIL: npmRegistryEmail,
      NPM_REGISTRY: npmRegistry,
    },
  })
  log.info(`logged in to npm-registry: "${npmRegistry}"`)
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
export const npmPublish = createStepExperimental<LocalSequentalTaskQueue, NpmPublishConfiguration>({
  stepName: 'npm-publish',
  stepGroup: 'npm-publish',
  taskQueueClass: LocalSequentalTaskQueue,
  run: ({ stepConfigurations, repoPath, log, immutableCache, processEnv }) => ({
    globalConstrains: [skipIfStepIsDisabledConstrain()],
    artifactConstrains: [
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
      artifact => customConstrain({ currentArtifact: artifact }),
    ],
    onBeforeArtifacts: async () =>
      npmRegistryLogin({
        npmRegistry: stepConfigurations.registry,
        npmRegistryPassword: stepConfigurations.publishAuth.password,
        npmRegistryEmail: stepConfigurations.publishAuth.email,
        npmRegistryUsername: stepConfigurations.publishAuth.username,
        repoPath,
        log,
      }),
    onAfterArtifacts: async () => execa.command(`npm logout --registry ${stepConfigurations.registry}`),
    onArtifact: async ({ artifact }) => {
      const newVersion = await calculateNextNewVersion({
        npmRegistry: stepConfigurations.registry,
        packageJson: artifact.data.artifact.packageJson,
        packagePath: artifact.data.artifact.packagePath,
        repoPath,
        log,
      })

      await setPackageVersion({
        artifact: artifact.data.artifact,
        fromVersion: artifact.data.artifact.packageJson.version,
        toVersion: newVersion,
      })

      await execaCommand(
        `yarn publish --registry ${stepConfigurations.registry} --non-interactive ${
          artifact.data.artifact.packageJson.name?.includes('@') ? `--access ${stepConfigurations.npmScopeAccess}` : ''
        }`,
        {
          stdio: 'pipe',
          cwd: artifact.data.artifact.packagePath,
          env: {
            // npm need this env-var for auth - this is needed only for production publishing.
            // in tests it doesn't do anything and we login manually to npm in tests.
            NPM_AUTH_TOKEN: stepConfigurations.publishAuth.password,
            NPM_PASSWORD: stepConfigurations.publishAuth.password,
          },
          log,
        },
      )
        .then(async () => {
          // wait (up to a 2 minutes) until the package is available
          for (let i = 0; i < 24; i++) {
            try {
              await execaCommand(
                `npm view ${artifact.data.artifact.packageJson.name}@${newVersion} --registry ${stepConfigurations.registry}`,
                {
                  stdio: 'ignore',
                  cwd: artifact.data.artifact.packagePath,
                  env: {
                    // npm need this env-var for auth - this is needed only for production publishing.
                    // in tests it doesn't do anything and we login manually to npm in tests.
                    NPM_AUTH_TOKEN: stepConfigurations.publishAuth.password,
                    NPM_PASSWORD: stepConfigurations.publishAuth.password,
                  },
                  log,
                },
              )
              break
            } catch (error) {
              if (error.stderr.includes('E404')) {
                await new Promise(res => setTimeout(res, 5_000))
              } else {
                throw error
              }
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
            ttl: immutableCache.ttls.ArtifactStepResult,
          }),
        )
        .finally(async () =>
          // revert version to what it was before we changed it
          setPackageVersion({
            artifact: artifact.data.artifact,
            fromVersion: newVersion,
            toVersion: artifact.data.artifact.packageJson.version,
          }),
        )

      log.info(`published npm target: "${artifact.data.artifact.packageJson.name}@${newVersion}"`)

      return {
        notes: [`published: "${artifact.data.artifact.packageJson.name}@${newVersion}"`],
        executionStatus: ExecutionStatus.done,
        status: Status.passed,
      }
    },
  }),
})
