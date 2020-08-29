// we don't want to use logger here. it's too verbose for a small cli-script
/* eslint-disable no-console */
import { intializeCache } from './cache'
import { CiOptions, Cleanup } from './types'
import { cleanup } from './utils'
import { MISSING_FLOW_ID_ERROR } from './constants'

export async function printFlowLogs(options: Pick<CiOptions<unknown>, 'flowId' | 'redis' | 'repoPath'>) {
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
    console.log(flowLogs)
  } catch (error) {
    if (error === MISSING_FLOW_ID_ERROR) {
      console.error(error)
    } else {
      console.error(`CI failed unexpectedly`, error)
    }
    process.exitCode = 1
  } finally {
    await cleanup(cleanups)
    console.log('stav1')
  }
}
