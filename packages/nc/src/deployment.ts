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
} from './types'
import { calculateCombinedStatus } from './utils'

const log = logger('deployment')

type PrepareDeployment<DeploymentClient> = { node: Node<PackageStepResult[StepName.publish]> } & (
  | {
      deployable: true
      targetType: TargetType
      deploymentResult: (deploymentClient: DeploymentClient) => Promise<Node<PackageStepResult[StepName.deployment]>>
    }
  | {
      deployable: false
      targetType?: TargetType
      deploymentResult: () => Promise<Node<PackageStepResult[StepName.deployment]>>
    }
)

function prepareDeployments<DeploymentClient>({
  startMs,
  delpoyment,
  orderedGraph,
}: {
  orderedGraph: Graph<PackageStepResult[StepName.publish]>
  startMs: number
  delpoyment: Deployment<DeploymentClient>
}): PrepareDeployment<DeploymentClient>[] {
  return orderedGraph.map(node => {
    const targetType = node.data.artifact.target?.targetType
    if (!targetType) {
      return {
        node,
        deployable: false,
        targetType,
        deploymentResult: async () => ({
          ...node,
          data: {
            artifact: node.data.artifact,
            stepResult: {
              stepName: StepName.deployment,
              durationMs: Date.now() - startMs,
              status: StepStatus.skippedAsPassed,
              notes: ['skipping deployment because this is a private-npm-package'],
            },
          },
        }),
      }
    }
    if (
      [StepStatus.failed, StepStatus.skippedAsFailed, StepStatus.skippedAsFailedBecauseLastStepFailed].includes(
        node.data.stepResult.status,
      )
    ) {
      return {
        node,
        deployable: false,
        targetType,
        deploymentResult: async () => ({
          ...node,
          data: {
            artifact: node.data.artifact,
            stepResult: {
              stepName: StepName.deployment,
              durationMs: Date.now() - startMs,
              status: StepStatus.skippedAsFailedBecauseLastStepFailed,
              notes: ['skipping deploy because the publish of this package failed'],
            },
          },
        }),
      }
    }
    const deployFunction = delpoyment[targetType]?.deploy
    if (!deployFunction) {
      return {
        node,
        deployable: false,
        targetType,
        deploymentResult: async () => ({
          ...node,
          data: {
            artifact: node.data.artifact,
            stepResult: {
              stepName: StepName.deployment,
              durationMs: Date.now() - startMs,
              status: StepStatus.skippedAsFailedBecauseLastStepFailed,
              notes: [`no deployment function was provided for target: ${targetType}`],
            },
          },
        }),
      }
    }
    return {
      node,
      deployable: true,
      targetType,
      deploymentResult: async (deploymentClient: DeploymentClient) => {
        try {
          await deployFunction({
            deploymentClient,
            artifactToDeploy: {
              packageJson: node.data.artifact.packageJson,
              packagePath: node.data.artifact.packagePath,
            },
          })
          return {
            ...node,
            data: {
              artifact: node.data.artifact,
              stepResult: {
                stepName: StepName.deployment,
                durationMs: Date.now() - startMs,
                status: StepStatus.passed,
                notes: [],
              },
            },
          }
        } catch (error) {
          return {
            ...node,
            data: {
              artifact: node.data.artifact,
              stepResult: {
                stepName: StepName.deployment,
                durationMs: Date.now() - startMs,
                status: StepStatus.failed,
                notes: [],
                error,
              },
            },
          }
        }
      },
    }
  })
}

export async function deploy<DeploymentClient>(
  orderedGraph: Graph<PackageStepResult[StepName.publish]>,
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
      packagesResult: orderedGraph.map(node => ({
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

  const prepares = prepareDeployments({ orderedGraph, startMs, delpoyment: options.delpoyment })

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
            throw new Error(`typescript is not perfect`)
          }
        }),
    ),
  )

  const deploymentResults = await Promise.all(
    prepares.map(async prepare => {
      if (prepare.targetType && prepare.deployable) {
        const deploymentClient = targetsToDeploy.get(prepare.targetType)!
        return prepare.deploymentResult(deploymentClient)
      } else {
        return prepare.deploymentResult()
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
      log.error(`${result.data.artifact.packageJson.name}: `)
      log.error(result.data.stepResult.error)
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
