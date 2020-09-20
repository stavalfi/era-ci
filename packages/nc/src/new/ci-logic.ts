import { attachLogFileTransport, logger } from '@tahini/log'
import fse from 'fs-extra'
import path from 'path'
import { getPackages } from '../utils'
import { calculateArtifactsHash } from './artifacts-hash'
import { Cache } from './create-cache'
import { StepExecutionStatus } from './create-step'
import { Cleanup, ConfigFile, PackageJson, RunStep, StepNodeData, StepResultOfAllPackages } from './types'
import { getExitCode, getStepsAsGraph, toFlowLogsContentKey } from './utils'

const log = logger('ci-logic')

export async function ci(options: { logFilePath: string; repoPath: string; configFile: ConfigFile }): Promise<void> {
  const cleanups: Cleanup[] = []
  let flowId: string | undefined = undefined
  let cache: Cache | undefined = undefined
  try {
    const startFlowMs = Date.now()

    // to avoid passing the logger instance between all the files and functions, we use ugly workaround:
    await attachLogFileTransport(options.logFilePath)

    // in tests, we extract the flowId using regex from this line (super ugly :S)
    log.info(`Starting CI`)

    const packagesPath = await getPackages(options.repoPath)

    const result = await calculateArtifactsHash({ repoPath: options.repoPath, packagesPath })

    flowId = result.repoHash

    log.info(`flow-id: "${flowId}"`)

    cache = await options.configFile.cache.callInitializeCache({ flowId, log: logger('cache') })
    cleanups.push(cache.cleanup)

    const rootPackageJson: PackageJson = await fse.readJson(path.join(options.repoPath, 'package.json'))

    const steps = getStepsAsGraph(options.configFile.steps)

    for (const node of steps) {
      const newStepData: StepNodeData<StepResultOfAllPackages> & { runStep: RunStep } = {
        ...node.data,
        stepExecutionStatus: StepExecutionStatus.done,
        stepResult: await node.data.runStep({
          allArtifacts: result.orderedGraph,
          allSteps: steps,
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

    process.exitCode = getExitCode(steps)
  } catch (error) {
    process.exitCode = 1
    log.error(`CI failed unexpectedly`, error)
  } finally {
    if (cache && flowId) {
      cache.set(toFlowLogsContentKey(flowId), await fse.readFile(options.logFilePath, 'utf-8'), cache.ttls.flowLogs)
    }
    await Promise.all(cleanups.map(f => f().catch(e => log.error(`cleanup function failed to run`, e))))
  }
}
