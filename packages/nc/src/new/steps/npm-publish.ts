import { npmRegistryLogin } from '../../npm-utils'
import { buildNpmTarget, getPackageTargetType } from '../../package-info'
import { execaCommand } from '../utils'
import { createStep, StepStatus } from '../create-step'
import { getServerInfoFromRegistryAddress } from '../utils'
import { setPackageVersion, TargetType } from './utils'
import { Log } from '../create-logger'

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

const getVersionCacheKey = ({ artifactHash }: { artifactHash: string }) => `${artifactHash}-npm-version`

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

export const npmPublish = createStep<NpmPublishConfiguration>({
  stepName: 'npm-publish',
  canRunStepOnArtifact: {
    customPredicate: async ({ currentArtifact, stepConfigurations, repoPath, cache, log }) => {
      if (!stepConfigurations.shouldPublish) {
        return {
          canRun: false,
          notes: [`npm-publish is disabled`],
          stepStatus: StepStatus.skippedAsPassed,
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
          stepStatus: StepStatus.skippedAsPassed,
        }
      }

      const npmVersionResult = await cache.get(
        getVersionCacheKey({ artifactHash: currentArtifact.data.artifact.packageHash }),
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
          stepStatus: StepStatus.skippedAsPassed,
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
  beforeAll: ({ stepConfigurations, repoPath }) =>
    npmRegistryLogin({
      npmRegistry: getServerInfoFromRegistryAddress(stepConfigurations.registry),
      npmRegistryEmail: stepConfigurations.publishAuth.email,
      npmRegistryToken: stepConfigurations.publishAuth.token,
      npmRegistryUsername: stepConfigurations.publishAuth.username,
      repoPath,
    }),
  runStepOnArtifact: async ({ currentArtifact, stepConfigurations, repoPath, log, cache, flowId, stepId }) => {
    const npmTarget = await buildNpmTarget({
      npmRegistry: getServerInfoFromRegistryAddress(stepConfigurations.registry),
      packageJson: currentArtifact.data.artifact.packageJson,
      packagePath: currentArtifact.data.artifact.packagePath,
      repoPath,
    })

    await setPackageVersion({
      artifact: currentArtifact.data.artifact,
      toVersion: npmTarget.newVersionIfPublish,
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
          getVersionCacheKey({ artifactHash: currentArtifact.data.artifact.packageHash }),
          npmTarget.newVersionIfPublish,
          cache.ttls.stepResult,
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
      status: StepStatus.passed,
    }
  },
})
