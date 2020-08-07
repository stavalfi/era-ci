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

function prepareDeployments<DeploymentClient>({
  startMs,
  graph,
  targetsInfo,
}: {
  graph: Graph<{ artifact: Artifact; stepResult: PackageStepResult[StepName.publish] }>
  startMs: number
  targetsInfo: TargetsInfo<DeploymentClient>
}): PrepareDeployment<DeploymentClient>[] {
  return graph.map(node => {
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

    const isPublishFailed = [
      StepStatus.failed,
      StepStatus.skippedAsFailed,
      StepStatus.skippedAsFailedBecauseLastStepFailed,
    ].includes(node.data.stepResult.status)
    if (isPublishFailed) {
      return {
        node: { ...node, data: node.data.artifact },
        deployable: false,
        targetType,
        deploymentResult: async () => ({
          stepName: StepName.deployment,
          durationMs: Date.now() - startMs,
          status: StepStatus.skippedAsFailedBecauseLastStepFailed,
          notes: ['skipping deploy because the publish of this package failed'],
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
          return {
            stepName: StepName.deployment,
            durationMs: Date.now() - startMs,
            status: StepStatus.passed,
            notes: [`deployed version ${publishedVersion}`],
          }
        } catch (error) {
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
  })
}

export async function deploy<DeploymentClient>(
  graph: Graph<{ artifact: Artifact; stepResult: PackageStepResult[StepName.publish] }>,
  options: {
    repoPath: string
    targetsInfo: TargetsInfo<DeploymentClient>
    executionOrder: number
  },
): Promise<PackagesStepResult<StepName.deployment>> {
  const startMs = Date.now()

  if (
    Object.values(options.targetsInfo)
      .filter(Boolean)
      .map(targetInfo => targetInfo?.shouldDeploy).length === 0
  ) {
    return {
      stepName: StepName.deployment,
      durationMs: Date.now() - startMs,
      executionOrder: options.executionOrder,
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

  log.info('deploying...')

  const deploymentsInfo = Object.entries(options.targetsInfo).reduce(
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

  const deploymentClientsByTargetType = Object.fromEntries(
    await Promise.all(
      Object.entries(deploymentsInfo).map<Promise<[string, DeploymentClient]>>(async ([key, value]) => [
        key,
        await value.initializeDeploymentClient(),
      ]),
    ),
  )

  const prepares = prepareDeployments({
    graph,
    startMs,
    targetsInfo: options.targetsInfo,
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

  await Promise.all(
    Object.entries(deploymentsInfo).map(([targetType, value]) =>
      value.destroyDeploymentClient({ deploymentClient: deploymentClientsByTargetType[targetType] }),
    ),
  )

  const withError = deploymentResults.filter(result => result.data.stepResult.error)
  if (withError.length > 0) {
    log.error(
      `the following packages had an error while deploying: ${withError
        .map(result => result.data.artifact.packageJson.name)
        .join(', ')}`,
    )
    withError.forEach(result => {
      log.error(`${result.data.artifact.packageJson.name}: `, result.data.stepResult.error)
    })
  }

  return {
    stepName: StepName.deployment,
    durationMs: Date.now() - startMs,
    executionOrder: options.executionOrder,
    status: calculateCombinedStatus(deploymentResults.map(node => node.data.stepResult.status)),
    packagesResult: deploymentResults,
    notes: [],
  }
}
