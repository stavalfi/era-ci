import { Cleanup, getGitRepoInfo, getPackages, Graph, PackageJson, StepInfo, toFlowLogsContentKey } from '@era-ci/utils'
import chance from 'chance'
import fs from 'fs'
import path from 'path'
import { calculateArtifactsHash } from './artifacts-hash'
import { Config } from './configuration'
import { Log, Logger } from './create-logger'
import { TaskQueueBase } from './create-task-queue'
import { createImmutableCache, ImmutableCache } from './immutable-cache'
import { connectToRedis } from './redis-client'
import { runAllSteps } from './steps-execution'
import { getExitCode } from './utils'

export async function ci(options: {
  repoPath: string
  config: Config<TaskQueueBase<any, any>>
  processEnv: NodeJS.ProcessEnv
}): Promise<{
  flowId: string
  repoHash?: string
  steps?: Graph<{ stepInfo: StepInfo }>
  passed: boolean
  fatalError: boolean
}> {
  process.stdout.setMaxListeners(Infinity)
  process.stderr.setMaxListeners(Infinity)

  const cleanups: Cleanup[] = []
  const connectionsCleanups: Cleanup[] = []
  const flowId = chance().hash().slice(0, 8)
  let fatalError: boolean
  let repoHash: string | undefined
  let immutableCache: ImmutableCache | undefined
  let log: Log | undefined
  let logger: Logger | undefined
  let steps: Graph<{ stepInfo: StepInfo }> | undefined
  let processExitCode = 0
  try {
    const startFlowMs = Date.now()
    logger = await options.config.logger.callInitializeLogger({
      repoPath: options.repoPath,
    })

    log = logger.createLog('ci-logic')

    log.info(`Starting CI - flow-id: "${flowId}"`)
    log.info(`directory: "${options.repoPath}"`)

    const gitRepoInfo = await getGitRepoInfo(options.repoPath, logger.createLog('ci-logic', { disable: true }))
    const packagesPath = await getPackages({ repoPath: options.repoPath, log })

    log.info(`git-repo: "${gitRepoInfo.repoName}"`)
    log.info(`git-commit: "${gitRepoInfo.commit}"`)
    log.info(`log-level: "${logger.logLevel}"`)
    log.info(`packages: ${packagesPath.length}`)

    // in the legacy-tests, we extract the flowId using regex from this line (super ugly :S)

    const { artifacts, repoHash: rh } = await calculateArtifactsHash({
      repoPath: options.repoPath,
      packagesPath,
      log: logger.createLog('calculate-hashes'),
    })

    repoHash = rh

    const redisClient = await connectToRedis({
      config: options.config.redis,
      logger,
    })
    connectionsCleanups.push(redisClient.cleanup)

    immutableCache = await createImmutableCache({
      artifacts,
      flowId,
      repoHash,
      log: logger.createLog('cache'),
      redisClient,
      ttls: {
        ArtifactStepResults: 1000 * 60 * 60 * 24 * 30, // 1 month
        flowLogs: 1000 * 60 * 30, // 30m
      },
    })
    cleanups.push(immutableCache.cleanup)

    const taskQueues = await Promise.all(
      options.config.taskQueues.map(t => {
        if (!logger) {
          throw new Error(`I can't be here`)
        }
        return t.createFunc({
          redisClient,
          log: logger.createLog(t.taskQueueName),
          gitRepoInfo,
          logger,
          repoPath: options.repoPath,
          processEnv: options.processEnv,
        })
      }),
    )
    cleanups.push(...taskQueues.map(t => () => t.cleanup()))

    steps = options.config.steps.map(s => ({ ...s, data: { stepInfo: s.data.stepInfo } }))

    const rootPackageJson: PackageJson = JSON.parse(
      await fs.promises.readFile(path.join(options.repoPath, 'package.json'), 'utf-8'),
    )

    const state = await runAllSteps({
      log,
      gitRepoInfo,
      rootPackageJson,
      stepsToRun: options.config.steps,
      immutableCache,
      logger,
      flowId,
      repoHash,
      repoPath: options.repoPath,
      startFlowMs,
      artifacts,
      steps,
      taskQueues,
      processEnv: options.processEnv,
      redisClient,
    })

    processExitCode = getExitCode(state)
    fatalError = false
  } catch (error: unknown) {
    fatalError = true
    processExitCode = 1
    if (log) {
      log.error(`CI failed unexpectedly: `, error)
    } else {
      // eslint-disable-next-line no-console
      console.error(`CI failed unexpectedly`, error)
    }
  }

  if (immutableCache && logger) {
    await immutableCache.set({
      key: toFlowLogsContentKey(flowId),
      value: await fs.promises.readFile(logger.logFilePath, 'utf-8'),
      asBuffer: true,
      ttl: immutableCache.ttls.flowLogs,
    })
  }
  await Promise.all(cleanups.map(f => f().catch(e => log?.error(`cleanup function failed to run`, e))))
  await Promise.all(
    connectionsCleanups.map(f => f().catch(e => log?.error(`cleanup function of a connection failed to run`, e))),
  )

  // 'SKIP_EXIT_CODE_1' is for test purposes
  if (!options.processEnv['SKIP_EXIT_CODE_1']) {
    process.exitCode = processExitCode
  }

  // jest don't print last 2 console.log lines so it's a workaround
  if (options.processEnv['ERA_TEST_MODE']) {
    // eslint-disable-next-line no-console
    console.log('------------------------')
    // eslint-disable-next-line no-console
    console.log('------------------------')
    // eslint-disable-next-line no-console
    console.log('------------------------')
  }

  return {
    flowId,
    repoHash,
    steps,
    passed: processExitCode === 0,
    fatalError,
  }
}
