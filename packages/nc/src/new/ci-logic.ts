import fse from 'fs-extra'
import path from 'path'
import { calculateArtifactsHash } from './artifacts-hash'
import { Cache } from './create-cache'
import { Log } from './create-logger'
import { StepExecutionStatus } from './create-step'
import { Cleanup, ConfigFile, PackageJson, RunStep, StepNodeData, StepResultOfAllPackages } from './types'
import { getExitCode, getPackages, getStepsAsGraph, toFlowLogsContentKey } from './utils'

export async function ci(options: { logFilePath: string; repoPath: string; configFile: ConfigFile }): Promise<void> {
  const cleanups: Cleanup[] = []
  let flowId: string | undefined = undefined
  let cache: Cache | undefined = undefined
  let log: Log | undefined
  try {
    const startFlowMs = Date.now()

    const logger = await options.configFile.logger.callInitializeLogger({ repoPath: options.repoPath })
    log = logger('ci-logic')

    // in tests, we extract the flowId using regex from this line (super ugly :S)
    log.info(`Starting CI`)

    const packagesPath = await getPackages({ repoPath: options.repoPath, log })

    const result = await calculateArtifactsHash({
      repoPath: options.repoPath,
      packagesPath,
      log: logger('calculate-hashes'),
    })

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
          logger,
        }),
      }
      node.data = newStepData
    }

    process.exitCode = getExitCode(steps)
  } catch (error) {
    process.exitCode = 1
    log?.error(`CI failed unexpectedly`, error)
  } finally {
    if (cache && flowId) {
      cache.set(toFlowLogsContentKey(flowId), await fse.readFile(options.logFilePath, 'utf-8'), cache.ttls.flowLogs)
    }
    await Promise.all(cleanups.map(f => f().catch(e => log?.error(`cleanup function failed to run`, e))))
  }
}
