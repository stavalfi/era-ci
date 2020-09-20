import { Log } from './create-logger'
import { Cleanup, ConfigFile } from './types'
import { MISSING_FLOW_ID_ERROR, toFlowLogsContentKey } from './utils'

export async function printFlowLogs(options: { flowId: string; configFile: ConfigFile; repoPath: string }) {
  const cleanups: Cleanup[] = []
  let log: Log | undefined
  try {
    const logger = await options.configFile.logger.callInitializeLogger({ repoPath: options.repoPath })
    log = logger('print-flow')
    const cache = await options.configFile.cache.callInitializeCache({ flowId: options.flowId, log: logger('cache') })
    cleanups.push(cache.cleanup)

    const flowLogs = await cache.get(toFlowLogsContentKey(options.flowId), r => {
      if (typeof r === 'string') {
        return r
      } else {
        throw new Error(
          `invalid value in cache. expected the type to be: string, acutal-type: ${typeof r}. actual value: ${r}`,
        )
      }
    })
    if (!flowLogs) {
      // we want to avoid stacktraces so we don't throw an Error object
      throw new Error(MISSING_FLOW_ID_ERROR)
    }
    log.noFormattingInfo(flowLogs)
  } catch (error) {
    if (error.message === MISSING_FLOW_ID_ERROR) {
      log?.error(error)
    } else {
      log?.error(`CI failed unexpectedly`, error)
    }
    process.exitCode = 1
  } finally {
    await Promise.all(cleanups.map(f => f().catch(e => log?.error(`cleanup function failed to run`, e))))
  }
}
