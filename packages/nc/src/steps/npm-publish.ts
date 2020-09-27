import fse from 'fs-extra'
import _ from 'lodash'
import os from 'os'
import path from 'path'
import { Log } from '../create-logger'
import { createStep, Status } from '../create-step'
import { PackageJson } from '../types'
import { execaCommand } from '../utils'
import { calculateNewVersion, getPackageTargetType, setPackageVersion, TargetType } from './utils'

export enum NpmScopeAccess {
  public = 'public',
  restricted = 'restricted',
}

export type NpmPublishConfiguration = {
  shouldPublish: boolean
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
      allVersions: string[]
    }
  | undefined
> {
  try {
    const command = `npm view ${packageName} --json --registry ${npmRegistry}`
    log.verbose(`searching the latest tag and hash: "${command}"`)
    const result = await execaCommand(command, { cwd: repoPath, stdio: 'pipe', log })
    const resultJson = JSON.parse(result.stdout) || {}
    const allVersions: string[] = resultJson['versions'] || []
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
    const npmLoginPath = require.resolve('.bin/npm-login-noninteractive')

    if (!silent) {
      log.verbose(`logging in to npm-registry: "${npmRegistry}"`)
    }
    // `npm-login-noninteractive` has a node-api but it prints logs so this is ugly workaround to avoid printing the logs
    await execaCommand(
      `${npmLoginPath} -u ${npmRegistryUsername} -p ${npmRegistryToken} -e ${npmRegistryEmail} -r ${npmRegistry}`,
      { cwd: repoPath, stdio: 'pipe', log },
    )
    if (!silent) {
      log.verbose(`logged in to npm-registry: "${npmRegistry}"`)
    }
  } else {
    await fse.writeFile(path.join(os.homedir(), '.npmrc'), `//${npmRegistry}/:_authToken=${npmRegistryToken}`)
  }
}

export const npmPublish = createStep<NpmPublishConfiguration>({
  stepName: 'npm-publish',
  canRunStepOnArtifact: {
    customPredicate: async ({ currentArtifact, stepConfigurations, repoPath, cache, log }) => {
      if (!stepConfigurations.shouldPublish) {
        return {
          canRun: false,
          notes: [`npm-publish is disabled`],
          stepStatus: Status.skippedAsPassed,
        }
      }

      const targetType = await getPackageTargetType(
        currentArtifact.data.artifact.packagePath,
        currentArtifact.data.artifact.packageJson,
      )

      if (targetType !== TargetType.npm) {
        return {
          canRun: false,
          notes: [],
          stepStatus: Status.skippedAsPassed,
        }
      }

      const npmVersionResult = await cache.get(
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
          canRun: true,
          notes: [],
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
          canRun: false,
          notes: [
            `this package was already published in flow: "${npmVersionResult.flowId}" with the same content as version: ${npmVersionResult.value}`,
          ],
          stepStatus: Status.skippedAsPassed,
        }
      }

      return {
        canRun: true,
        notes: [],
      }
    },
    options: {
      // maybe the publish already succeed but someone deleted the target from the registry so we need to check that manually as well
      skipIfPackageResultsInCache: false,
    },
  },
  beforeAll: ({ stepConfigurations, repoPath, log }) =>
    npmRegistryLogin({
      npmRegistry: stepConfigurations.registry,
      npmRegistryEmail: stepConfigurations.publishAuth.email,
      npmRegistryToken: stepConfigurations.publishAuth.token,
      npmRegistryUsername: stepConfigurations.publishAuth.username,
      repoPath,
      log,
    }),
  runStepOnArtifact: async ({ currentArtifact, stepConfigurations, repoPath, log, cache, flowId, stepId }) => {
    const newVersion = await calculateNextNewVersion({
      npmRegistry: stepConfigurations.registry,
      packageJson: currentArtifact.data.artifact.packageJson,
      packagePath: currentArtifact.data.artifact.packagePath,
      repoPath,
      log,
    })

    await setPackageVersion({
      artifact: currentArtifact.data.artifact,
      toVersion: newVersion,
    })

    await execaCommand(
      `yarn publish --registry ${stepConfigurations.registry} --non-interactive ${
        currentArtifact.data.artifact.packageJson.name?.includes('@')
          ? `--access ${stepConfigurations.npmScopeAccess}`
          : ''
      }`,
      {
        stdio: 'inherit',
        cwd: currentArtifact.data.artifact.packagePath,
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
        cache.set(
          getVersionCacheKey({
            artifactHash: currentArtifact.data.artifact.packageHash,
            artifactName: currentArtifact.data.artifact.packageJson.name,
          }),
          newVersion,
          cache.ttls.stepSummary,
        ),
      )
      .finally(() =>
        // revert version to what it was before we changed it
        setPackageVersion({
          artifact: currentArtifact.data.artifact,
          toVersion: currentArtifact.data.artifact.packageJson.version!,
        }),
      )

    log.info(`published npm target in package: "${currentArtifact.data.artifact.packageJson.name}"`)

    return {
      notes: [],
      status: Status.passed,
    }
  },
})
