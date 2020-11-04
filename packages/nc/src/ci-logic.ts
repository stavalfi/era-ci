import fse from 'fs-extra'
import { calculateArtifactsHash } from './artifacts-hash'
import { Config } from './configuration'
import { Cache } from './create-cache'
import { Log, Logger } from './create-logger'
import { StepInfo } from './create-step'
import { runAllSteps } from './steps-execution'
import { Cleanup, Graph } from './types'
import { getExitCode, getPackages, toFlowLogsContentKey } from './utils'
import chance from 'chance'

export async function ci(options: {
  repoPath: string
  config: Config
}): Promise<{ flowId: string; repoHash?: string; steps?: Graph<{ stepInfo: StepInfo }>; passed: boolean }> {
  const cleanups: Cleanup[] = []
  const flowId = chance().hash()
  let repoHash: string | undefined
  let cache: Cache | undefined = undefined
  let log: Log | undefined
  let logger: Logger | undefined
  let steps: Graph<{ stepInfo: StepInfo }> | undefined
  try {
    const startFlowMs = Date.now()

    logger = await options.config.logger.callInitializeLogger({ repoPath: options.repoPath })
    log = logger.createLog('ci-logic')

    // in the legacy-tests, we extract the flowId using regex from this line (super ugly :S)
    log.info(`Starting CI - flow-id: "${flowId}"`)

    const packagesPath = await getPackages({ repoPath: options.repoPath, log })

    const { artifacts, repoHash: rh } = await calculateArtifactsHash({
      repoPath: options.repoPath,
      packagesPath,
      log: logger.createLog('calculate-hashes'),
    })

    repoHash = rh

    cache = await options.config.cache.callInitializeCache({
      flowId,
      repoHash,
      log: logger.createLog('cache'),
      artifacts,
    })
    cleanups.push(cache.cleanup)

    steps = options.config.steps.map(s => ({ ...s, data: { stepInfo: s.data.stepInfo } }))

    const { stepsResultOfArtifactsByStep } = await runAllSteps({
      stepsToRun: options.config.steps,
      cache,
      logger,
      flowId,
      repoHash,
      repoPath: options.repoPath,
      startFlowMs,
      artifacts,
      steps,
    })

    process.exitCode = getExitCode(stepsResultOfArtifactsByStep)
  } catch (error: unknown) {
    process.exitCode = 1
    log?.error(`CI failed unexpectedly`, error)
  } finally {
    if (cache && logger) {
      await cache.set({
        key: toFlowLogsContentKey(flowId),
        value: await fse.readFile(logger.logFilePath, 'utf-8'),
        ttl: cache.ttls.flowLogs,
        allowOverride: false,
      })
    }
    await Promise.all(cleanups.map(f => f().catch(e => log?.error(`cleanup function failed to run`, e))))
  }

  return {
    flowId,
    repoHash,
    steps,
    passed: process.exitCode === 0 ? true : false,
  }
}
