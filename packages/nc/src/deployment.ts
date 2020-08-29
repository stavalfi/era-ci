import { logger } from '@tahini/log'
import {
  Graph,
  Node,
  PackagesStepResult,
  PackageStepResult,
  StepName,
  StepStatus,
  TargetType,
  Artifact,
  TargetsInfo,
  DeployTarget,
  Cache,
} from './types'
import { calculateCombinedStatus } from './utils'
import { buildFullDockerImageName } from './docker-utils'

const log = logger('deployment')

type PrepareDeployment<DeploymentClient> = { node: Node<Artifact> } & (
  | {
      deployable: true
      targetType: TargetType
      deploymentResult: (deploymentClient: DeploymentClient) => Promise<PackageStepResult[StepName.deployment]>
    }
  | {
      deployable: false
      targetType?: TargetType
      deploymentResult: () => Promise<PackageStepResult[StepName.deployment]>
    }
)

async function prepareDeployments<DeploymentClient>({
  startMs,
  graph,
  targetsInfo,
  deploymentCache,
}: {
  graph: Graph<{ artifact: Artifact; stepResult: PackageStepResult[StepName.publish] }>
  startMs: number
  targetsInfo: TargetsInfo<DeploymentClient>
  deploymentCache: Cache['deployment']
}): Promise<PrepareDeployment<DeploymentClient>[]> {
  return Promise.all(
    graph.map<Promise<PrepareDeployment<DeploymentClient>>>(async node => {
      const targetType = node.data.artifact.targetType
      if (!targetType) {
        return {
          node: { ...node, data: node.data.artifact },
          deployable: false,
          targetType,
          deploymentResult: async () => ({
            stepName: StepName.deployment,
            durationMs: Date.now() - startMs,
            status: StepStatus.skippedAsPassed,
            notes: ['skipping deployment because this is a private-npm-package'],
          }),
        }
      }

      if (
        node.data.stepResult.status === StepStatus.failed ||
        node.data.stepResult.status === StepStatus.skippedAsFailed ||
        node.data.stepResult.status === StepStatus.skippedAsFailedBecauseLastStepFailed
      ) {
        return {
          node: { ...node, data: node.data.artifact },
          deployable: false,
          targetType,
          deploymentResult: async () => ({
            stepName: StepName.deployment,
            durationMs: Date.now() - startMs,
            status: StepStatus.skippedAsFailedBecauseLastStepFailed,
            notes: ['skipping deploy because publish step failed'],
          }),
        }
      }

      const publishedVersion = node.data.stepResult.publishedVersion

      if (!publishedVersion) {
        return {
          node: { ...node, data: node.data.artifact },
          deployable: false,
          targetType,
          deploymentResult: async () => ({
            stepName: StepName.deployment,
            durationMs: Date.now() - startMs,
            status: StepStatus.skippedAsPassed,
            notes: ['skipping deploy because there is nothing to deploy'],
          }),
        }
      }

      const targetInfo = targetsInfo[targetType]
      if (!targetInfo) {
        return {
          node: { ...node, data: node.data.artifact },
          deployable: false,
          targetType,
          deploymentResult: async () => ({
            stepName: StepName.deployment,
            durationMs: Date.now() - startMs,
            status: StepStatus.skippedAsPassed,
            notes: [`there isn't any deployment configuration for ${targetType} targets`],
          }),
        }
      }

      const cache = deploymentCache[targetType]! // because `targetInfo` is truethy

      const isDeploymentRun = await cache.isDeploymentRun(
        node.data.artifact.packageJson.name!,
        node.data.artifact.packageHash,
      )

      if (isDeploymentRun) {
        const isDeployed = await cache.isDeployed(node.data.artifact.packageJson.name!, node.data.artifact.packageHash)
        if (isDeployed) {
          log.info(
            `we see that we already deployed the package "${node.data.artifact.packageJson.name}" with the exect same content in the past. re-doploying again...`,
          )
        } else {
          log.info(
            `we see that we already failed to deployed the package "${node.data.artifact.packageJson.name}" with the exect same content in the past. re-doploying again...`,
          )
        }
      }

      if (!targetInfo.shouldDeploy) {
        return {
          node: { ...node, data: node.data.artifact },
          deployable: false,
          targetType,
          deploymentResult: async () => ({
            stepName: StepName.deployment,
            durationMs: Date.now() - startMs,
            status: StepStatus.skippedAsPassed,
            notes: [`ci is configured to skip deployment for ${targetType} targets`],
          }),
        }
      }

      const deployFunction = targetInfo.deployment?.deploy
      if (!deployFunction) {
        return {
          node: { ...node, data: node.data.artifact },
          deployable: false,
          targetType,
          deploymentResult: async () => ({
            stepName: StepName.deployment,
            durationMs: Date.now() - startMs,
            status: StepStatus.skippedAsPassed,
            notes: [`no deployment function was provided for target: ${targetType}`],
          }),
        }
      }

      return {
        node: { ...node, data: node.data.artifact },
        deployable: true,
        targetType,
        deploymentResult: async (deploymentClient: DeploymentClient) => {
          try {
            await deployFunction({
              // @ts-ignore - typescript bug - `deployFunction` type is channged and is not true in this line
              deploymentClient,
              // @ts-ignore - typescript bug - `depdeployFunctionloy` type is channged and is not true in this line
              artifactToDeploy: {
                packageJson: node.data.artifact.packageJson,
                packagePath: node.data.artifact.packagePath,
                publishedVersion,
                ...(targetType === TargetType.docker && {
                  fullImageName: buildFullDockerImageName({
                    // @ts-ignore - typescript can't understand that its valid
                    dockerOrganizationName: targetInfo.dockerOrganizationName,
                    dockerRegistry: targetInfo.registry,
                    packageJsonName: node.data.artifact.packageJson.name!,
                    imageTag: publishedVersion,
                  }),
                }),
              },
            })
            await cache.setDeploymentResult(node.data.artifact.packageJson.name!, node.data.artifact.packageHash, true)
            return {
              stepName: StepName.deployment,
              durationMs: Date.now() - startMs,
              status: StepStatus.passed,
              notes: [`deployed version ${publishedVersion}`],
            }
          } catch (error) {
            await cache.setDeploymentResult(node.data.artifact.packageJson.name!, node.data.artifact.packageHash, false)
            return {
              stepName: StepName.deployment,
              durationMs: Date.now() - startMs,
              status: StepStatus.failed,
              notes: [],
              error,
            }
          }
        },
      }
    }),
  )
}

export async function deploy<DeploymentClient>({
  executionOrder,
  graph,
  targetsInfo,
  deploymentCache,
}: {
  graph: Graph<{ artifact: Artifact; stepResult: PackageStepResult[StepName.publish] }>
  repoPath: string
  targetsInfo?: TargetsInfo<DeploymentClient>
  executionOrder: number
  deploymentCache: Cache['deployment']
}): Promise<PackagesStepResult<StepName.deployment>> {
  const startMs = Date.now()

  log.info('deploying...')

  if (
    !targetsInfo ||
    Object.values(targetsInfo)
      .filter(Boolean)
      .map(targetInfo => targetInfo?.shouldDeploy).length === 0
  ) {
    return {
      stepName: StepName.deployment,
      durationMs: Date.now() - startMs,
      executionOrder,
      status: StepStatus.skippedAsPassed,
      packagesResult: graph.map(node => ({
        ...node,
        data: {
          artifact: node.data.artifact,
          stepResult: {
            stepName: StepName.deployment,
            durationMs: Date.now() - startMs,
            status: StepStatus.skippedAsPassed,
            notes: [],
          },
        },
      })),
      notes: ['ci is configured to skip deployment'],
    }
  }

  const deploymentsInfo = Object.entries(targetsInfo).reduce(
    (acc: { [targetTypeKey: string]: DeployTarget<DeploymentClient, TargetType> }, [key, value]) => {
      if (value?.shouldDeploy) {
        return {
          ...acc,
          [key]: value.deployment,
        }
      } else {
        return acc
      }
    },
    {},
  )

  const deploymentClientsOrErrorByTargetType = Object.fromEntries(
    await Promise.all(
      Object.entries(deploymentsInfo).map<
        Promise<[string, { deploymentClient: DeploymentClient } | { error: unknown }]>
      >(async ([key, value]) => [
        key,
        await value.initializeDeploymentClient().then(
          deploymentClient => ({ deploymentClient }),
          error => ({ error }),
        ),
      ]),
    ),
  )

  const initializeWithErrors = Object.entries(deploymentClientsOrErrorByTargetType).flatMap<[string, unknown]>(
    ([key, value]) => {
      if ('error' in value) {
        return [[key, value.error]]
      } else {
        return []
      }
    },
  )

  if (initializeWithErrors.length > 0) {
    log.error(
      `the following target-types had an error while calling to "initializeDeploymentClient" (inside nc.config file): ${initializeWithErrors
        .map(result => result[0])
        .join(', ')}`,
    )
    initializeWithErrors.forEach(([targetType, error]) => {
      log.error(targetType, error)
    })
    return {
      stepName: StepName.deployment,
      durationMs: Date.now() - startMs,
      executionOrder,
      status: StepStatus.failed,
      packagesResult: graph.map(node => ({
        ...node,
        data: {
          artifact: node.data.artifact,
          stepResult: {
            stepName: StepName.deployment,
            durationMs: Date.now() - startMs,
            status: StepStatus.skippedAsFailed,
            notes: [],
          },
        },
      })),
      notes: ['"initializeDeploymentClient" function threw an error (inside nc.config file)'],
    }
  }

  const deploymentClientsByTargetType = Object.fromEntries(
    Object.entries(deploymentClientsOrErrorByTargetType).map(([key, value]) => [
      key,
      ('deploymentClient' in value && value.deploymentClient) as DeploymentClient,
    ]),
  )

  const prepares = await prepareDeployments({
    graph,
    startMs,
    targetsInfo: targetsInfo,
    deploymentCache,
  })

  const deploymentResults: Graph<{
    artifact: Artifact
    stepResult: PackageStepResult[StepName.deployment]
  }> = await Promise.all(
    prepares.map(async prepare => {
      if (prepare.targetType && prepare.deployable) {
        const deploymentClient = deploymentClientsByTargetType[prepare.targetType]
        return {
          ...prepare.node,
          data: {
            artifact: prepare.node.data,
            stepResult: await prepare.deploymentResult(deploymentClient),
          },
        }
      } else {
        return {
          ...prepare.node,
          data: {
            artifact: prepare.node.data,
            stepResult: await prepare.deploymentResult(),
          },
        }
      }
    }),
  )

  const deployWithError = deploymentResults.filter(result => result.data.stepResult.error)
  if (deployWithError.length > 0) {
    log.error(
      `the following packages had an error while deploying: ${deployWithError
        .map(result => result.data.artifact.packageJson.name)
        .join(', ')}`,
    )
    deployWithError.forEach(result => {
      log.error(`${result.data.artifact.packageJson.name}: `, result.data.stepResult.error)
    })
  }

  const destroyErrors = Object.entries(
    (
      await Promise.all(
        Object.entries(deploymentsInfo).map(async ([targetType, value]) => {
          const error: null | unknown = await value
            .destroyDeploymentClient({ deploymentClient: deploymentClientsByTargetType[targetType] })
            .then(
              () => null,
              error => error,
            )
          if (error) {
            return { [targetType]: error }
          } else {
            return {}
          }
        }),
      )
    ).reduce((acc, r) => ({ ...acc, ...r }), {}),
  )

  if (destroyErrors.length > 0) {
    log.error(
      `the following target-types had an error while calling "destroyDeploymentClient" (inside nc.config file): ${destroyErrors
        .map(result => result[0])
        .join(', ')}`,
    )
    destroyErrors.forEach(([targetType, error]) => {
      log.error(targetType, error)
    })

    return {
      stepName: StepName.deployment,
      durationMs: Date.now() - startMs,
      executionOrder,
      status: StepStatus.failed,
      packagesResult: deploymentResults,
      notes: ['"destroyDeploymentClient" function threw an error (inside nc.config file)'],
    }
  }

  return {
    stepName: StepName.deployment,
    durationMs: Date.now() - startMs,
    executionOrder,
    status: calculateCombinedStatus(deploymentResults.map(node => node.data.stepResult.status)),
    packagesResult: deploymentResults,
    notes: [],
  }
}
