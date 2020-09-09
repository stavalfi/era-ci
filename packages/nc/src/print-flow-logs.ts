import { logger } from '@tahini/log'
import { intializeCache } from './cache'
import { MISSING_FLOW_ID_ERROR } from './constants'
import { CiOptions, Cleanup } from './types'
import { cleanup } from './utils'

const log = logger('ci-logic')

export async function printFlowLogs(options: Pick<CiOptions<unknown>, 'redis' | 'repoPath'> & { flowId: string }) {
  const cleanups: Cleanup[] = []
  try {
    const cache = await intializeCache({
      flowId: options.flowId,
      redis: options.redis,
      repoPath: options.repoPath,
      targetsInfo: {},
    })
    cleanups.push(cache.cleanup)

    const flowLogs = await cache.flow.readFlowLogsContent(options.flowId)
    if (!flowLogs) {
      // we want to avoid stacktraces so we don't throw an Error object
      throw MISSING_FLOW_ID_ERROR
    }
    log.noFormattingInfo(flowLogs)
  } catch (error) {
    if (error === MISSING_FLOW_ID_ERROR) {
      log.error(error)
    } else {
      log.error(`CI failed unexpectedly`, error)
    }
    process.exitCode = 1
  } finally {
    await cleanup(cleanups)
  }
}
