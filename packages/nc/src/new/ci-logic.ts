import { attachLogFileTransport, logger } from '@tahini/log'
import fse from 'fs-extra'
import path from 'path'
import { CiOptions, Graph } from '../types'
import { getPackages } from '../utils'
import { calculateArtifactsHash } from './artifacts-hash'
import { intializeCache } from './cache'
import getConfig from './config.example'
import {
  Cleanup,
  PackageJson,
  RunStep,
  Step,
  StepExecutionStatus,
  StepNodeData,
  StepResultOfAllPackages,
} from './types'

const log = logger('ci-logic')

function getStepsAsGraph(steps: Step[]): Graph<StepNodeData<StepResultOfAllPackages> & { runStep: RunStep }> {
  return steps.map((step, i, array) => ({
    index: i,
    data: {
      stepInfo: {
        stepName: step.stepName,
        stepId: `${step.stepName}-${i}`,
      },
      runStep: step.runStep,
      stepExecutionStatus: StepExecutionStatus.scheduled,
    },
    childrenIndexes: i === 0 ? [] : [i - 1],
    parentsIndexes: i === array.length - 1 ? [] : [i - 1],
  }))
}

export async function ci(options: {
  logFilePath: string
  repoPath: string
  redis: CiOptions<unknown>['redis']
}): Promise<void> {
  const cleanups: Cleanup[] = []

  // TODO: validate packages that each has name and version in the package.json (including root package.json)

  try {
    const startFlowMs = Date.now()

    // to avoid passing the logger instance between all the files and functions, we use ugly workaround:
    await attachLogFileTransport(options.logFilePath)

    // in tests, we extract the flowId using regex from this line (super ugly :S)
    log.info(`Starting CI`)

    const config = await getConfig()

    const packagesPath = await getPackages(options.repoPath)

    const result = await calculateArtifactsHash({ repoPath: options.repoPath, packagesPath })

    const flowId = result.repoHash

    log.info(`flow-id: "${flowId}"`)

    const cache = await intializeCache({ flowId, redis: options.redis })
    cleanups.push(cache.cleanup)

    const rootPackageJson: PackageJson = await fse.readJson(path.join(options.repoPath, 'package.json'))

    const allSteps = getStepsAsGraph(config.steps)

    for (const node of allSteps) {
      const newStepData: StepNodeData<StepResultOfAllPackages> & { runStep: RunStep } = {
        ...node.data,
        stepExecutionStatus: StepExecutionStatus.done,
        stepResult: await node.data.runStep({
          allArtifacts: result.orderedGraph,
          allSteps,
          stepName: node.data.stepInfo.stepName,
          stepId: node.data.stepInfo.stepId,
          currentStepIndex: node.index,
          repoPath: options.repoPath,
          rootPackage: {
            packageJson: rootPackageJson,
            packagePath: options.repoPath,
          },
          cache,
          flowId,
          startFlowMs,
        }),
      }
      node.data = newStepData
    }
  } catch (error) {
    process.exitCode = 1
    log.error(`CI failed unexpectedly`, error)
    await Promise.all(cleanups.map(f => f().catch(e => log.error(`cleanup function failed to run`, e))))
  }
}
