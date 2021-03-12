import { calculateArtifactsHash } from '@era-ci/artifact-hash'
import { Cleanup, getGitRepoInfo, getPackages, Graph, PackageJson, StepInfo } from '@era-ci/utils'
import chance from 'chance'
import fs from 'fs'
import path from 'path'
import { Config } from './configuration'
import { Log, Logger } from './create-logger'
import { TaskQueueBase } from './create-task-queue'
import { createImmutableCache, ImmutableCache } from './immutable-cache'
import { connectToRedis } from './redis-client'
import { runAllSteps } from './steps-execution'
import { CiResult } from './types'
import { checkIfAllChangesCommitted, finishFlow, getExitCode } from './utils'

export { CiResult }

export async function ci(options: {
  repoPath: string
  config: Config<TaskQueueBase<any, any>>
  processEnv: NodeJS.ProcessEnv
}): Promise<CiResult> {
  process.stdout.setMaxListeners(Infinity)
  process.stderr.setMaxListeners(Infinity)

  const cleanups: Cleanup[] = []
  const connectionsCleanups: Cleanup[] = []
  const flowId = chance().hash().slice(0, 8)
  let fatalError = false
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
      flowId,
    })

    log = logger.createLog('ci-logic')

    log.info(`Starting CI - flow-id: "${flowId}"`)
    log.info(`directory: "${options.repoPath}"`)

    const gitRepoInfo = await getGitRepoInfo({
      repoPath: options.repoPath,
      log: logger.createLog('ci-logic', { disable: true }),
    })
    const packagesPath = await getPackages({ repoPath: options.repoPath, processEnv: options.processEnv }).then(r =>
      Object.values(r).map(w => w.location),
    )

    const { artifacts, rootFilesHash, repoHash: rh } = await calculateArtifactsHash({
      repoPath: options.repoPath,
      packagesPath,
    })

    repoHash = rh

    log.info(`git-repo: "${gitRepoInfo.repoName}"`)
    log.info(`git-commit: "${gitRepoInfo.commit}"`)
    log.info(`repo-hash: "${repoHash}"`)
    log.info(`root-files-hash: "${rootFilesHash}"`)
    log.info(`log-level: "${logger.logLevel}"`)
    log.info(`packages: ${packagesPath.length}`)

    log.verbose('calculated hashes to every package in the monorepo:')
    log.verbose(`root-files -> ${rh}`)
    log.verbose(`${artifacts.length} packages:`)
    artifacts.forEach(node =>
      log!.verbose(
        `${node.data.artifact.relativePackagePath} (${node.data.artifact.packageJson.name}) -> ${node.data.artifact.packageHash}`,
      ),
    )
    log.verbose('---------------------------------------------------')

    if (!(await checkIfAllChangesCommitted({ repoPath: options.repoPath, log }))) {
      processExitCode = 1
      return finishFlow({
        cleanups,
        processExitCode,
        fatalError,
        flowId,
        processEnv: options.processEnv,
        connectionsCleanups,
        immutableCache,
        log,
        logger,
        repoHash,
        steps,
      })
    }

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

  return finishFlow({
    cleanups,
    processExitCode,
    fatalError,
    flowId,
    processEnv: options.processEnv,
    connectionsCleanups,
    immutableCache,
    log,
    logger,
    repoHash,
    steps,
  })
}
