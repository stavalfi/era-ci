import { Cleanup, getGitRepoInfo, getPackages, Graph, PackageJson, StepInfo, toFlowLogsContentKey } from '@era-ci/utils'
import chance from 'chance'
import fse from 'fs-extra'
import path from 'path'
import { calculateArtifactsHash } from './artifacts-hash'
import { Config } from './configuration'
import { Log, Logger } from './create-logger'
import { createImmutableCache, ImmutableCache } from './immutable-cache'
import { connectToRedis } from './redis-client'
import { runAllSteps } from './steps-execution'
import { getExitCode, getStepsResultOfArtifactsByStepAndArtifact } from './utils'

export async function ci<TaskQueue>(options: {
  repoPath: string
  config: Config<TaskQueue>
  processEnv: NodeJS.ProcessEnv
  customLog?: (...values: unknown[]) => void
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
  const flowId = chance().hash().slice(0, 8)
  let fatalError: boolean
  let repoHash: string | undefined
  let immutableCache: ImmutableCache | undefined
  let log: Log | undefined
  let logger: Logger | undefined
  let steps: Graph<{ stepInfo: StepInfo }> | undefined
  try {
    const startFlowMs = Date.now()
    logger = await options.config.logger.callInitializeLogger({
      repoPath: options.repoPath,
      customLog: options.customLog,
    })

    log = logger.createLog('ci-logic')

    log.info(`-----------------------------------------`)
    log.info(`Starting CI - flow-id: "${flowId}"`)
    log.info(`directory: "${options.repoPath}"`)

    const gitRepoInfo = await getGitRepoInfo(options.repoPath, logger.createLog('ci-logic', { disable: true }))
    log.info(`git-repo: "${gitRepoInfo.repoName}"`)
    log.info(`git-commit: "${gitRepoInfo.commit}"`)
    log.info(`log-level: "${logger.logLevel}"`)
    log.info(`-----------------------------------------`)

    // in the legacy-tests, we extract the flowId using regex from this line (super ugly :S)

    const packagesPath = await getPackages({ repoPath: options.repoPath, log })

    const { artifacts, repoHash: rh } = await calculateArtifactsHash({
      repoPath: options.repoPath,
      packagesPath,
      log: logger.createLog('calculate-hashes'),
    })

    repoHash = rh

    const redisClient = await connectToRedis(options.config.redis)
    cleanups.push(redisClient.cleanup)

    immutableCache = await createImmutableCache({
      artifacts,
      flowId,
      repoHash,
      log: logger.createLog('cache'),
      redisClient,
      ttls: {
        ArtifactStepResult: 1000 * 60 * 60 * 24 * 7,
        flowLogs: 1000 * 60 * 60 * 24 * 7,
      },
    })
    cleanups.push(immutableCache.cleanup)

    const taskQueues = await Promise.all(
      options.config.taskQueues.map(t => {
        if (!logger) {
          throw new Error(`I can't be here`)
        }
        return t.createFunc({
          log: logger.createLog(t.taskQueueName),
          gitRepoInfo,
          logger,
          repoPath: options.repoPath,
        })
      }),
    )
    cleanups.push(...taskQueues.map(t => () => t.cleanup()))

    steps = options.config.steps.map(s => ({ ...s, data: { stepInfo: s.data.stepInfo } }))

    const rootPackageJson: PackageJson = await fse.readJson(path.join(options.repoPath, 'package.json'))

    const state = getStepsResultOfArtifactsByStepAndArtifact({ artifacts, steps })

    const allStepsEvents$ = await runAllSteps(
      {
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
      },
      state,
    )

    await allStepsEvents$.toPromise()

    process.exitCode = getExitCode(state.stepsResultOfArtifactsByStep)
    fatalError = false
  } catch (error: unknown) {
    fatalError = true
    process.exitCode = 1
    log?.error(`CI failed unexpectedly`, error)
  } finally {
    if (immutableCache && logger) {
      await immutableCache.set({
        key: toFlowLogsContentKey(flowId),
        value: await fse.readFile(logger.logFilePath, 'utf-8'),
        asBuffer: true,
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
    fatalError,
  }
}
