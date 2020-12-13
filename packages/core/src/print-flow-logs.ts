import { calculateArtifactsHash } from './artifacts-hash'
import { Config } from './configuration'
import { Log } from './create-logger'
import { createImmutableCache } from './immutable-cache'
import { getPackages, MISSING_FLOW_ID_ERROR, toFlowLogsContentKey, Cleanup } from '@tahini/utils'

export async function printFlowLogs<TaskQueue>(options: {
  flowId: string
  config: Config<TaskQueue>
  repoPath: string
}): Promise<void> {
  const cleanups: Cleanup[] = []
  let log: Log | undefined
  try {
    const logger = await options.config.logger.callInitializeLogger({ repoPath: options.repoPath })
    log = logger.createLog('print-flow')

    const packagesPath = await getPackages({ repoPath: options.repoPath, log })

    const { artifacts } = await calculateArtifactsHash({
      repoPath: options.repoPath,
      packagesPath,
      log: logger.createLog('calculate-hashes'),
    })

    const keyValueStoreConnection = await options.config.keyValueStore.callInitializeKeyValueStoreConnection()
    cleanups.push(keyValueStoreConnection.cleanup)

    const immutableCache = await createImmutableCache({
      artifacts,
      flowId: 'it-wont-be-used-so-we-dont-pass-it',
      repoHash: 'it-wont-be-used-so-we-dont-pass-it-as-well',
      log: logger.createLog('cache'),
      keyValueStoreConnection,
      ttls: {
        ArtifactStepResult: 1000 * 60 * 60 * 24 * 7,
        flowLogs: 1000 * 60 * 60 * 24 * 7,
      },
    })
    cleanups.push(immutableCache.cleanup)

    const flowLogsResult = await immutableCache.get(toFlowLogsContentKey(options.flowId), r => {
      if (typeof r === 'string') {
        return r
      } else {
        throw new Error(
          `invalid value in cache. expected the type to be: string, acutal-type: ${typeof r}. actual value: ${r}`,
        )
      }
    })
    if (!flowLogsResult) {
      // we want to avoid stacktraces so we don't throw an Error object
      throw MISSING_FLOW_ID_ERROR
    }
    log.noFormattingInfo(flowLogsResult.value)
  } catch (error) {
    if (error === MISSING_FLOW_ID_ERROR) {
      log?.noFormattingError(error)
    } else {
      log?.error(`CI failed unexpectedly`, error)
    }
    process.exitCode = 1
  }
  const result = await Promise.allSettled(
    cleanups.map(f => f().catch(e => log?.error(`cleanup function failed to run`, e))),
  )
  if (result.some(r => r.status === 'rejected')) {
    throw result
  }
}