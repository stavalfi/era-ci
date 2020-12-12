import { skipIfStepIsDisabledConstrain } from '@tahini/constrains'
import {
  ConstrainResultType,
  createConstrain,
  createStepExperimental,
  Log,
  StepEventType,
  StepInputEvents,
  StepOutputEvents,
} from '@tahini/core'
import { LocalSequentalTaskQueue } from '@tahini/task-queues'
import {
  Artifact,
  calculateNewVersion,
  concatMapOnce,
  execaCommand,
  ExecutionStatus,
  getPackageTargetType,
  Node,
  PackageJson,
  setPackageVersion,
  Status,
  TargetType,
} from '@tahini/utils'
import { skipIfArtifactStepResultMissingOrFailedInCacheConstrain } from 'constrains/src'
import fse from 'fs-extra'
import _ from 'lodash'
import npmLogin from 'npm-login-noninteractive'
import os from 'os'
import path from 'path'
import { of } from 'rxjs'
import { mergeMap } from 'rxjs/operators'

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
    highestPublishedVersion: npmhighestVersionInfo?.highestVersion,
    allVersions: npmhighestVersionInfo?.allVersions,
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
  silent,
  repoPath,
  log,
}: {
  silent?: boolean
  npmRegistry: string
  npmRegistryUsername: string
  npmRegistryToken: string
  npmRegistryEmail: string
  repoPath: string
  log: Log
}): Promise<void> {
  // only login in tests. publishing in non-interactive mode is very buggy and tricky.
  // ---------------------------------------------------------------------------------
  // it's an ugly why to check if we are in a test but at least,
  // it doesn't use env-var (that the user can use by mistake) or addtional ci-parameter.
  if (npmRegistryEmail === 'root@root.root') {
    npmLogin(npmRegistryUsername, npmRegistryToken, npmRegistryEmail, npmRegistry)
    if (!silent) {
      log.verbose(`logged in to npm-registry: "${npmRegistry}"`)
    }
  } else {
    await fse.writeFile(path.join(os.homedir(), '.npmrc'), `//${npmRegistry}/:_authToken=${npmRegistryToken}`)
  }
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
    const targetType = await getPackageTargetType(
      currentArtifact.data.artifact.packagePath,
      currentArtifact.data.artifact.packageJson,
    )

    if (targetType !== TargetType.npm) {
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
  taskQueueClass: LocalSequentalTaskQueue,
  run: async ({ stepConfigurations, repoPath, log, immutableCache, stepInputEvents$, runConstrains }) => {
    const constrainsResult = await runConstrains([skipIfStepIsDisabledConstrain()])

    if (constrainsResult.combinedResultType === ConstrainResultType.shouldSkip) {
      return of({
        type: StepEventType.step,
        stepResult: constrainsResult.combinedResult,
      })
    }

    return stepInputEvents$.pipe(
      concatMapOnce(
        e => e.type === StepEventType.artifactStep && e.artifactStepResult.executionStatus === ExecutionStatus.done,
        () =>
          npmRegistryLogin({
            npmRegistry: stepConfigurations.registry,
            npmRegistryEmail: stepConfigurations.publishAuth.email,
            npmRegistryToken: stepConfigurations.publishAuth.token,
            npmRegistryUsername: stepConfigurations.publishAuth.username,
            repoPath,
            log,
          }),
      ),
      mergeMap<StepInputEvents[StepEventType], Promise<StepOutputEvents[StepEventType]>>(async e => {
        if (e.type === StepEventType.artifactStep && e.artifactStepResult.executionStatus === ExecutionStatus.done) {
          const constrainsResult = await runConstrains([
            skipIfArtifactStepResultMissingOrFailedInCacheConstrain({
              currentArtifact: e.artifact,
              stepNameToSearchInCache: 'build',
              skipAsFailedIfStepNotFoundInCache: true,
              skipAsPassedIfStepNotExists: false,
            }),
            skipIfArtifactStepResultMissingOrFailedInCacheConstrain({
              currentArtifact: e.artifact,
              stepNameToSearchInCache: 'test',
              skipAsFailedIfStepNotFoundInCache: true,
              skipAsPassedIfStepNotExists: false,
            }),
            customConstrain({ currentArtifact: e.artifact }),
          ])

          if (constrainsResult.combinedResultType === ConstrainResultType.shouldSkip) {
            return {
              type: StepEventType.step,
              stepResult: constrainsResult.combinedResult,
            }
          }

          const newVersion = await calculateNextNewVersion({
            npmRegistry: stepConfigurations.registry,
            packageJson: e.artifact.data.artifact.packageJson,
            packagePath: e.artifact.data.artifact.packagePath,
            repoPath,
            log,
          })

          await setPackageVersion({
            artifact: e.artifact.data.artifact,
            fromVersion: e.artifact.data.artifact.packageJson.version,
            toVersion: newVersion,
          })

          await execaCommand(
            `yarn publish --registry ${stepConfigurations.registry} --non-interactive ${
              e.artifact.data.artifact.packageJson.name?.includes('@')
                ? `--access ${stepConfigurations.npmScopeAccess}`
                : ''
            }`,
            {
              stdio: 'inherit',
              cwd: e.artifact.data.artifact.packagePath,
              env: {
                // npm need this env-var for auth - this is needed only for production publishing.
                // in tests it doesn't do anything and we login manually to npm in tests.
                NPM_AUTH_TOKEN: stepConfigurations.publishAuth.token,
                NPM_TOKEN: stepConfigurations.publishAuth.token,
              },
              log,
            },
          )
            .then(() =>
              immutableCache.set({
                key: getVersionCacheKey({
                  artifactHash: e.artifact.data.artifact.packageHash,
                  artifactName: e.artifact.data.artifact.packageJson.name,
                }),
                value: newVersion,
                ttl: immutableCache.ttls.ArtifactStepResult,
              }),
            )
            .finally(async () =>
              // revert version to what it was before we changed it
              setPackageVersion({
                artifact: e.artifact.data.artifact,
                fromVersion: newVersion,
                toVersion: e.artifact.data.artifact.packageJson.version,
              }),
            )

          log.info(`published npm target: "${e.artifact.data.artifact.packageJson.name}@${newVersion}"`)

          return {
            type: StepEventType.artifactStep,
            artifactName: e.artifact.data.artifact.packageJson.name,
            artifactStepResult: {
              notes: [`published: "${e.artifact.data.artifact.packageJson.name}@${newVersion}"`],
              executionStatus: ExecutionStatus.done,
              status: Status.passed,
            },
          }
        } else {
          return e
        }
      }),
    )
  },
})
