import fse from 'fs-extra'
import { calculateArtifactsHash } from './artifacts-hash'
import { Config } from './configuration'
import { Log, Logger } from './create-logger'
import { StepInfo } from './create-step'
import { runAllSteps } from './steps-execution'
import { Cleanup, Graph } from './types'
import { getExitCode, getPackages, toFlowLogsContentKey } from './utils'
import chance from 'chance'
import { createImmutableCache, ImmutableCache } from './immutable-cache'

export async function ci<TaskQueueArray extends Array<{ taskQueueName: string }>>(options: {
  repoPath: string
  config: Config<TaskQueueArray>
}): Promise<{ flowId: string; repoHash?: string; steps?: Graph<{ stepInfo: StepInfo }>; passed: boolean }> {
  const cleanups: Cleanup[] = []
  const flowId = chance().hash()
  let repoHash: string | undefined
  let immutableCache: ImmutableCache | undefined
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

    const keyValueStoreConnection = await options.config.keyValueStore.callInitializeKeyValueStoreConnection()
    cleanups.push(keyValueStoreConnection.cleanup)

    immutableCache = await createImmutableCache({
      artifacts,
      flowId,
      repoHash,
      log: logger.createLog('cache'),
      keyValueStoreConnection,
      ttls: {
        ArtifactStepResult: 1000 * 60 * 60 * 24 * 7,
        flowLogs: 1000 * 60 * 60 * 24 * 7,
      },
    })
    cleanups.push(immutableCache.cleanup)

    steps = options.config.steps.map(s => ({ ...s, data: { stepInfo: s.data.stepInfo } }))

    const { stepsResultOfArtifactsByStep } = await runAllSteps({
      stepsToRun: options.config.steps,
      immutableCache,
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
    if (immutableCache && logger) {
      await immutableCache.set({
        key: toFlowLogsContentKey(flowId),
        value: await fse.readFile(logger.logFilePath, 'utf-8'),
        ttl: immutableCache.ttls.flowLogs,
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
