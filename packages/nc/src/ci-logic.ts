import chance from 'chance'
import fse from 'fs-extra'
import { calculateArtifactsHash } from './artifacts-hash'
import { Config } from './configuration'
import { Log, Logger } from './create-logger'
import { StepInfo } from './create-step'
import { createImmutableCache, ImmutableCache } from './immutable-cache'
import { runAllSteps } from './steps-execution'
import { Cleanup, Graph } from './types'
import { getExitCode, getPackages, toFlowLogsContentKey } from './utils'
import gitUrlParse from 'git-url-parse'
import gitRemoteOriginUrl from 'git-remote-origin-url'
import nodegit from 'nodegit'
import path from 'path'

export async function ci<TaskQueue>(options: {
  repoPath: string
  config: Config<TaskQueue>
}): Promise<{
  flowId: string
  repoHash?: string
  steps?: Graph<{ stepInfo: StepInfo }>
  passed: boolean
  fatalError: boolean
}> {
  const cleanups: Cleanup[] = []
  const flowId = chance().hash()
  let fatalError: boolean
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

    const gitInfo = gitUrlParse(await gitRemoteOriginUrl(options.repoPath))
    const git = await nodegit.Repository.open(path.join(options.repoPath, '.git'))
    const commit = await git.getHeadCommit()

    const taskQueues = await Promise.all(
      options.config.taskQueues.map(t => {
        if (!logger) {
          throw new Error(`I can't be here`)
        }
        return t.createFunc({
          log: logger.createLog(t.taskQueueName),
          gitRepoInfo: {
            auth: {
              username: '1',
              token: gitInfo.token,
            },
            commit: commit.sha(),
            repoName: gitInfo.name,
            repoNameWithOrgName: gitInfo.full_name,
          },
        })
      }),
    )

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
      taskQueues,
    })

    process.exitCode = getExitCode(stepsResultOfArtifactsByStep)
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
