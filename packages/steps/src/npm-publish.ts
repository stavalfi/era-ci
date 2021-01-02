import { skipIfStepIsDisabledConstrain } from '@era-ci/constrains'
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
import { skipIfArtifactStepResultMissingOrFailedInCacheConstrain } from '@era-ci/constrains'
import fse from 'fs-extra'
import _ from 'lodash'
import npmLogin from 'npm-login-noninteractive'
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
  publishAuth: {
    email: string
    username: string
    token: string
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
  npmRegistryEmail,
  npmRegistryToken,
  npmRegistryUsername,
  log,
}: {
  npmRegistry: string
  npmRegistryUsername: string
  npmRegistryToken: string
  npmRegistryEmail: string
  log: Log
}): Promise<void> {
  // only login in tests. publishing in non-interactive mode is very buggy and tricky.
  // ---------------------------------------------------------------------------------
  // it's an ugly why to check if we are in a test but at least,
  // it doesn't use env-var (that the user can use by mistake) or addtional ci-parameter.
  if (npmRegistryEmail === 'root@root.root') {
    npmLogin(npmRegistryUsername, npmRegistryToken, npmRegistryEmail, npmRegistry)
  } else {
    await fse.writeFile(path.join(os.homedir(), '.npmrc'), `//${npmRegistry}/:_authToken=${npmRegistryToken}`)
  }
  log.verbose(`logged in to npm-registry: "${npmRegistry}"`)
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

    const npmVersionResult = await immutableCache.get(
      getVersionCacheKey({
        artifactHash: currentArtifact.data.artifact.packageHash,
        artifactName: currentArtifact.data.artifact.packageJson.name,
      }),
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
  run: ({ stepConfigurations, repoPath, log, immutableCache }) => ({
    globalConstrains: [skipIfStepIsDisabledConstrain()],
    artifactConstrains: [
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
      artifact => customConstrain({ currentArtifact: artifact }),
    ],
    onBeforeArtifacts: async () =>
      npmRegistryLogin({
        npmRegistry: stepConfigurations.registry,
        npmRegistryEmail: stepConfigurations.publishAuth.email,
        npmRegistryToken: stepConfigurations.publishAuth.token,
        npmRegistryUsername: stepConfigurations.publishAuth.username,
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
          stdio: 'inherit',
          cwd: artifact.data.artifact.packagePath,
          env: {
            // npm need this env-var for auth - this is needed only for production publishing.
            // in tests it doesn't do anything and we login manually to npm in tests.
            NPM_AUTH_TOKEN: stepConfigurations.publishAuth.token,
            NPM_TOKEN: stepConfigurations.publishAuth.token,
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
                  stdio: 'inherit',
                  cwd: artifact.data.artifact.packagePath,
                  env: {
                    // npm need this env-var for auth - this is needed only for production publishing.
                    // in tests it doesn't do anything and we login manually to npm in tests.
                    NPM_AUTH_TOKEN: stepConfigurations.publishAuth.token,
                    NPM_TOKEN: stepConfigurations.publishAuth.token,
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
