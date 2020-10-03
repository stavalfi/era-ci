import { calculateArtifactsHash } from './artifacts-hash'
import { Config } from './configuration'
import { Log } from './create-logger'
import { Cleanup } from './types'
import { getPackages, MISSING_FLOW_ID_ERROR, toFlowLogsContentKey } from './utils'

export async function printFlowLogs(options: { flowId: string; config: Config; repoPath: string }): Promise<void> {
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

    const cache = await options.config.cache.callInitializeCache({
      flowId: options.flowId,
      log: logger.createLog('cache'),
      artifacts,
    })
    cleanups.push(cache.cleanup)

    const flowLogsResult = await cache.get(toFlowLogsContentKey(options.flowId), r => {
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
      throw new Error(MISSING_FLOW_ID_ERROR)
    }
    log.noFormattingInfo(flowLogsResult.value)
  } catch (error) {
    if (error?.message === MISSING_FLOW_ID_ERROR) {
      log?.error(error)
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
