import { logger } from '@tahini/log'
import {
  Auth,
  Cache,
  Deployment,
  Graph,
  Node,
  PackagesStepResult,
  PackageStepResult,
  ServerInfo,
  StepName,
  StepStatus,
  TargetType,
  Artifact,
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
  delpoyment,
  graph,
  dockerOrganizationName,
  dockerRegistry,
}: {
  graph: Graph<{ artifact: Artifact; stepResult: PackageStepResult[StepName.publish] }>
  startMs: number
  delpoyment: Deployment<DeploymentClient>
  dockerOrganizationName: string
  dockerRegistry: ServerInfo
}): PrepareDeployment<DeploymentClient>[] {
  return graph.map(node => {
    const targetType = node.data.artifact.target?.targetType
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
      [StepStatus.failed, StepStatus.skippedAsFailed, StepStatus.skippedAsFailedBecauseLastStepFailed].includes(
        node.data.stepResult.status,
      )
    ) {
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
    const deployFunction = delpoyment[targetType]?.deploy
    if (!deployFunction) {
      return {
        node: { ...node, data: node.data.artifact },
        deployable: false,
        targetType,
        deploymentResult: async () => ({
          stepName: StepName.deployment,
          durationMs: Date.now() - startMs,
          status: StepStatus.skippedAsFailedBecauseLastStepFailed,
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
          const publishResult = graph.find(
            node1 => node1.data.artifact.packageJson.name === node.data.artifact.packageJson.name,
          )!
          const publishedVersion = publishResult.data.stepResult.publishedVersion! // up above, we go out if the publish failed
          await deployFunction({
            deploymentClient,
            // @ts-ignore - ts should accept it...
            artifactToDeploy: {
              packageJson: node.data.artifact.packageJson,
              packagePath: node.data.artifact.packagePath,
              publishedVersion,
              ...(node.data.artifact.target?.targetType === TargetType.docker && {
                fullImageName: buildFullDockerImageName({
                  dockerOrganizationName,
                  dockerRegistry,
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
            notes: [],
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
    npmRegistry: ServerInfo
    dockerRegistry: ServerInfo
    dockerOrganizationName: string
    cache: Cache
    auth: Auth
    shouldDeploy: boolean
    delpoyment: Deployment<DeploymentClient>
    executionOrder: number
  },
): Promise<PackagesStepResult<StepName.deployment>> {
  const startMs = Date.now()

  if (!options.shouldDeploy) {
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

  // const deploymentClient = await options.delpoyment.

  const prepares = prepareDeployments({
    graph,
    startMs,
    delpoyment: options.delpoyment,
    dockerRegistry: options.dockerRegistry,
    dockerOrganizationName: options.dockerOrganizationName,
  })

  const targetsToDeploy = new Map(
    await Promise.all(
      Object.keys(options.delpoyment)
        .map(key => Object.values(TargetType).find(k => k === key))
        .filter(
          targetType => targetType && prepares.some(prepare => prepare.deployable && prepare.targetType === targetType),
        )
        .map<Promise<[TargetType, DeploymentClient]>>(async targetType => {
          if (targetType) {
            const deploymentClient = await options.delpoyment[targetType]!.initializeDeploymentClient()
            return [targetType, deploymentClient]
          } else {
            throw new Error(
              `typescript is forcing me to throw this error - we shouldn't be here - but with my luck, we will probably be here every run :P`,
            )
          }
        }),
    ),
  )

  const deploymentResults: Graph<{
    artifact: Artifact
    stepResult: PackageStepResult[StepName.deployment]
  }> = await Promise.all(
    prepares.map(async prepare => {
      if (prepare.targetType && prepare.deployable) {
        const deploymentClient = targetsToDeploy.get(prepare.targetType)!
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
    [...targetsToDeploy.entries()].map(async ([targetType, deploymentClient]) => {
      const destroyDeploymentClient = options.delpoyment[targetType]?.destroyDeploymentClient
      if (!destroyDeploymentClient) {
        throw new Error(`destroyDeploymentClient function is missing under deployment.${targetType} section`)
      } else {
        await destroyDeploymentClient({ deploymentClient })
      }
    }),
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
