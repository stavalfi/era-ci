import fse from 'fs-extra'
import path from 'path'
import { calculateArtifactsHash } from './artifacts-hash'
import { ConfigFile } from './configuration'
import { Cache } from './create-cache'
import { Log, Logger } from './create-logger'
import { StepExecutionStatus } from './create-step'
import { Cleanup, PackageJson } from './types'
import { getExitCode, getPackages, getStepsAsGraph, toFlowLogsContentKey } from './utils'

export async function ci(options: { repoPath: string; configFile: ConfigFile }): Promise<void> {
  const cleanups: Cleanup[] = []
  let flowId: string | undefined = undefined
  let cache: Cache | undefined = undefined
  let log: Log | undefined
  let logger: Logger | undefined
  try {
    const startFlowMs = Date.now()

    logger = await options.configFile.logger.callInitializeLogger({ repoPath: options.repoPath })
    log = logger.createLog('ci-logic')

    // in tests, we extract the flowId using regex from this line (super ugly :S)
    log.info(`Starting CI`)

    const packagesPath = await getPackages({ repoPath: options.repoPath, log })

    const result = await calculateArtifactsHash({
      repoPath: options.repoPath,
      packagesPath,
      log: logger.createLog('calculate-hashes'),
    })

    flowId = result.repoHash

    log.info(`flow-id: "${flowId}"`)

    cache = await options.configFile.cache.callInitializeCache({ flowId, log: logger.createLog('cache') })
    cleanups.push(cache.cleanup)

    const rootPackageJson: PackageJson = await fse.readJson(path.join(options.repoPath, 'package.json'))

    const steps = getStepsAsGraph(options.configFile.steps)

    for (const node of steps) {
      const newStepData = {
        ...node.data,
        stepExecutionStatus: StepExecutionStatus.done,
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
          repoPath: options.repoPath,
          rootPackageJson: rootPackageJson,
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
    console.log('stav6')
    process.exitCode = 1
    log?.error(`CI failed unexpectedly`, error)
  }
  if (cache && flowId && logger) {
    await cache.set(toFlowLogsContentKey(flowId), await fse.readFile(logger.logFilePath, 'utf-8'), cache.ttls.flowLogs)
  }
  const result = await Promise.allSettled(
    cleanups.map(f => f().catch(e => log?.error(`cleanup function failed to run`, e))),
  )
  if (result.some(r => r.status === 'rejected')) {
    throw result
  }
  console.log('stav7')
}
