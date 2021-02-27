import { Cleanup, getPackages, MISSING_FLOW_ID_ERROR, toFlowLogsContentKey } from '@era-ci/utils'
import { calculateArtifactsHash } from '@era-ci/artifact-hash'
import { Config } from './configuration'
import { Log } from './create-logger'
import { createImmutableCache } from './immutable-cache'
import { connectToRedis } from './redis-client'
import { TaskQueueBase } from './create-task-queue'

export async function printFlowLogs(options: {
  flowId: string
  config: Config<TaskQueueBase<any, any>>
  repoPath: string
  processEnv: NodeJS.ProcessEnv
}): Promise<string> {
  const cleanups: Cleanup[] = []
  let log: Log | undefined
  let logs = 'no-logs'
  try {
    const logger = await options.config.logger.callInitializeLogger({
      repoPath: options.repoPath,
      disableFileOutput: true,
    })
    log = logger.createLog('print-flow')

    const packagesPath = await getPackages({ repoPath: options.repoPath, processEnv: options.processEnv }).then(r =>
      Object.values(r).map(w => w.location),
    )

    const { artifacts } = await calculateArtifactsHash({
      repoPath: options.repoPath,
      packagesPath,
    })

    const redisClient = await connectToRedis({ config: options.config.redis, logger })
    cleanups.push(redisClient.cleanup)

    const immutableCache = await createImmutableCache({
      artifacts,
      flowId: 'it-wont-be-used-so-we-dont-pass-it',
      repoHash: 'it-wont-be-used-so-we-dont-pass-it-as-well',
      log: logger.createLog('cache'),
      redisClient,
      ttls: {
        ArtifactStepResults: -1, // it won't be used here
        flowLogs: -1, // it won't be used here
      },
    })
    cleanups.push(immutableCache.cleanup)

    const flowLogsResult = await immutableCache.get({
      key: toFlowLogsContentKey(options.flowId),
      isBuffer: true,
      mapper: r => {
        if (typeof r === 'string') {
          return r
        } else {
          throw new Error(
            `invalid value in cache. expected the type to be: string, acutal-type: ${typeof r}. actual value: ${r}`,
          )
        }
      },
    })
    if (!flowLogsResult) {
      // we want to avoid stacktraces so we don't throw an Error object
      throw MISSING_FLOW_ID_ERROR
    }
    logs = flowLogsResult.value
    log.noFormattingInfo(logs)
  } catch (error) {
    if (error === MISSING_FLOW_ID_ERROR) {
      log?.noFormattingError(error)
    } else {
      log?.error(`CI failed unexpectedly`, error)
    }
    // 'SKIP_EXIT_CODE_1' is for test purposes
    if (!options.processEnv['SKIP_EXIT_CODE_1']) {
      process.exitCode = 1
    }
  }
  const result = await Promise.allSettled(
    cleanups.map(f => f().catch(e => log?.error(`cleanup function failed to run`, e))),
  )
  if (result.some(r => r.status === 'rejected')) {
    throw result
  }

  return logs
}
