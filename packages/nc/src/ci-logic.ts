import fse from 'fs-extra'
import { calculateArtifactsHash } from './artifacts-hash'
import { ConfigFile } from './configuration'
import { Cache } from './create-cache'
import { Log, Logger } from './create-logger'
import { runAllSteps } from './steps-execution'
import { Cleanup } from './types'
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

    const stepsToRun = getStepsAsGraph(options.configFile.steps)

    const stepResultOfArtifacts = await runAllSteps({
      stepsToRun,
      cache,
      logger,
      flowId,
      repoPath: options.repoPath,
      startFlowMs,
    })

    process.exitCode = getExitCode(stepResultOfArtifacts)
  } catch (error) {
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
}
