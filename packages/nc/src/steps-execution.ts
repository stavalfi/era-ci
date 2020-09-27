import fse from 'fs-extra'
import path from 'path'
import { Cache } from './create-cache'
import { Logger } from './create-logger'
import { ExecutionStatus, Step, StepInfo, StepsResultOfArtifactsByStep } from './create-step'
import { Graph, PackageJson } from './types'

export async function runAllSteps({
  repoPath,
  stepsToRun,
  startFlowMs,
  flowId,
  cache,
  logger,
}: {
  repoPath: string
  stepsToRun: Graph<{ stepInfo: StepInfo; runStep: Step['runStep'] }>
  flowId: string
  startFlowMs: number
  cache: Cache
  logger: Logger
}): Promise<StepsResultOfArtifactsByStep<unknown>> {
  const rootPackageJson: PackageJson = await fse.readJson(path.join(repoPath, 'package.json'))

  for (const node of steps) {
    const newStepData = {
      ...node.data,
      stepExecutionStatus: ExecutionStatus.done,
      stepSummary: await node.data.runStep({
        artifacts: result.orderedGraph,
        steps: steps,
        stepName: node.data.stepInfo.stepName,
        stepId: node.data.stepInfo.stepId,
        currentStepInfo: {
          ...node,
          data: {
            stepInfo: node.data.stepInfo,
          },
        },
        repoPath,
        rootPackageJson: rootPackageJson,
        cache,
        flowId,
        startFlowMs,
        logger,
      }),
    }
    node.data = newStepData
  }
  return []
}
