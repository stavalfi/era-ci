import { npmRegistryLogin } from '../../npm-utils'
import { buildNpmTarget, getPackageTargetType } from '../../package-info'
import { TargetType } from '../../types'
import { execaCommand } from '../../utils'
import { createStep } from '../create-step'
import { StepStatus } from '../types'
import { getServerInfoFromRegistryAddress } from '../utils'
import { setPackageVersion } from './utils'

export type DockerPublishConfiguration = {
  shouldPublish: boolean
  registry: string
  publishAuth: {
    username: string
    token: string
  }
  dockerOrganizationName: string
}

export const dockerPublish = createStep<DockerPublishConfiguration>({
  stepName: 'docker-publish',
  canRunStepOnArtifact: {
    customPredicate: async ({ currentArtifact, stepConfigurations }) => {
      if (!stepConfigurations.shouldPublish) {
        return {
          canRun: false,
          notes: [`docker-publish is disabled`],
          stepStatus: StepStatus.skippedAsPassed,
        }
      }

      const targetType = await getPackageTargetType(
        currentArtifact.data.artifact.packagePath,
        currentArtifact.data.artifact.packageJson,
      )
      if (targetType !== TargetType.docker) {
        return {
          canRun: false,
          notes: [],
          stepStatus: StepStatus.skippedAsPassed,
        }
      }

      return {
        canRun: true,
        notes: [],
      }
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
  runStepOnArtifact: async ({ currentArtifact, stepConfigurations, repoPath, log }) => {
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
      },
    ).finally(() =>
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
