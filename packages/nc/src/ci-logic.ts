import fse from 'fs-extra'
import { calculateArtifactsHash } from './artifacts-hash'
import { Config } from './configuration'
import { Cache } from './create-cache'
import { Log, Logger } from './create-logger'
import { StepInfo } from './create-step'
import { runAllSteps } from './steps-execution'
import { Cleanup, Graph } from './types'
import { getExitCode, getPackages, toFlowLogsContentKey } from './utils'

export async function ci(options: {
  repoPath: string
  config: Config
}): Promise<{ flowId?: string; steps?: Graph<{ stepInfo: StepInfo }>; passed: boolean }> {
  const cleanups: Cleanup[] = []
  let flowId: string | undefined = undefined
  let cache: Cache | undefined = undefined
  let log: Log | undefined
  let logger: Logger | undefined
  let steps: Graph<{ stepInfo: StepInfo }> | undefined
  try {
    const startFlowMs = Date.now()

    logger = await options.config.logger.callInitializeLogger({ repoPath: options.repoPath })
    log = logger.createLog('ci-logic')

    // in tests, we extract the flowId using regex from this line (super ugly :S)
    log.info(`Starting CI`)

    const packagesPath = await getPackages({ repoPath: options.repoPath, log })

    const { artifacts, repoHash } = await calculateArtifactsHash({
      repoPath: options.repoPath,
      packagesPath,
      log: logger.createLog('calculate-hashes'),
    })

    flowId = repoHash

    log.info(`flow-id: "${flowId}"`)

    cache = await options.config.cache.callInitializeCache({ flowId, log: logger.createLog('cache') })
    cleanups.push(cache.cleanup)

    steps = options.config.steps.map(s => ({ ...s, data: { stepInfo: s.data.stepInfo } }))

    const { stepsResultOfArtifactsByStep } = await runAllSteps({
      stepsToRun: options.config.steps,
      cache,
      logger,
      flowId,
      repoPath: options.repoPath,
      startFlowMs,
      artifacts,
      steps,
    })

    process.exitCode = getExitCode(stepsResultOfArtifactsByStep)
    // log.noFormattingInfo(JSON.stringify(stepsResultOfArtifactsByStep, null, 2))
  } catch (error) {
    process.exitCode = 1
    log?.error(`CI failed unexpectedly`, error)
  }
  if (cache && flowId && logger) {
    await cache.set(toFlowLogsContentKey(flowId), await fse.readFile(logger.logFilePath, 'utf-8'), cache.ttls.flowLogs)
  }
  await Promise.all(cleanups.map(f => f().catch(e => log?.error(`cleanup function failed to run`, e))))

  return {
    flowId,
    steps,
    passed: process.exitCode === 0 ? true : false,
  }
}
