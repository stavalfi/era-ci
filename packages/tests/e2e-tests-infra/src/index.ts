import { ci, config, Config, createImmutableCache, Logger, LogLevel, StepInfo, TaskQueueBase } from '@tahini/core'
import { listTags } from '@tahini/image-registry-client'
import { redisConnection } from '@tahini/key-value-stores'
import { winstonLogger } from '@tahini/loggers'
import { JsonReport, jsonReporter, jsonReporterCacheKey, stringToJsonReport } from '@tahini/steps'
import { localSequentalTaskQueue } from '@tahini/task-queues'
import { ExecutionStatus, Graph, Status } from '@tahini/utils'
import chance from 'chance'
import fse from 'fs-extra'
import path from 'path'
import execa from 'execa'
import { createGitRepo } from './create-git-repo'
import { resourcesBeforeAfterAll } from './prepare-test-resources'
import { getPublishResult } from './seach-targets'
import { Cleanup, Repo, ResultingArtifact, TestResources, ToActualName } from './types'
import { addReportToStepsAsLastNodes } from './utils'

export { createGitRepo } from './create-git-repo'
export { DeepPartial, TestResources } from './types'
export { isDeepSubset, sleep } from './utils'

const { getResources } = resourcesBeforeAfterAll()

const getJsonReport = async ({
  flowId,
  repoHash,
  jsonReportStepId,
  testLogger,
}: {
  flowId: string
  repoHash: string
  jsonReportStepId: string
  testLogger: Logger
}): Promise<JsonReport> => {
  const keyValueStoreConnection = await redisConnection({
    redisServerUri: getResources().redisServerUri,
  }).callInitializeKeyValueStoreConnection()
  const immutableCache = await createImmutableCache({
    artifacts: [],
    flowId,
    repoHash,
    log: testLogger.createLog('cache'),
    keyValueStoreConnection,
    ttls: {
      ArtifactStepResult: 1000 * 60 * 60 * 24 * 7,
      flowLogs: 1000 * 60 * 60 * 24 * 7,
    },
  })
  try {
    const jsonReportResult = await immutableCache.get(jsonReporterCacheKey({ flowId, stepId: jsonReportStepId }), r => {
      if (typeof r === 'string') {
        return stringToJsonReport({ jsonReportAsString: r })
      } else {
        throw new Error(
          `invalid value in cache. expected the type to be: string, acutal-type: ${typeof r}. actual value: ${r}`,
        )
      }
    })
    if (!jsonReportResult) {
      throw new Error(`can't find json-report in the cache. failing test`)
    }
    return jsonReportResult.value
  } finally {
    await keyValueStoreConnection.cleanup()
    await immutableCache.cleanup()
  }
}

type RunCiResult = {
  flowId: string
  steps: Graph<{ stepInfo: StepInfo }>
  jsonReport: JsonReport
  passed: boolean
  logFilePath: string
  flowLogs: string
  published: Map<string, ResultingArtifact>
}

const runCi = <TaskQueue extends TaskQueueBase<unknown>>({
  repoPath,
  configurations,
  logFilePath,
  stepsDontContainReport,
  toOriginalName,
  getResources,
  testLogger,
}: {
  repoPath: string
  configurations: Config<TaskQueue>
  logFilePath: string
  stepsDontContainReport: boolean
  toOriginalName: (artifactName: string) => string
  getResources: () => TestResources
  testLogger: Logger
}) => async (options?: { processEnv?: NodeJS.ProcessEnv }): Promise<RunCiResult> => {
  const { flowId, repoHash, steps, passed, fatalError } = await ci({
    repoPath,
    config: configurations,
    // DO NOT CHANGE THE DEFAULT VALUE! we don't want the tests to depend on the real "process.env"!!!
    // if we will depend on it, we can't parallelize any test in AVA!!
    processEnv: options?.processEnv ?? {},
  })

  if (!repoHash) {
    throw new Error(`ci didn't return repo-hash. it looks like a bug`)
  }

  if (!steps) {
    throw new Error(`ci didn't return steps-graph. can't find json-report`)
  }
  const jsonReportStepId = steps.find(s => s.data.stepInfo.stepName === jsonReporter().stepName)?.data.stepInfo.stepId
  if (!fatalError && !stepsDontContainReport && !jsonReportStepId) {
    throw new Error(`can't find jsonReportStepId. can't find json-report`)
  }

  const jsonReport =
    !fatalError &&
    !stepsDontContainReport &&
    (await getJsonReport({
      testLogger,
      flowId,
      repoHash,
      jsonReportStepId:
        jsonReportStepId || `we will never be here. this default value is here only because of typescript.`,
    }))

  const published = await getPublishResult({
    testLogger,
    getResources,
    toOriginalName,
    repoPath,
  })

  return {
    flowId,
    logFilePath,
    flowLogs: await fse.readFile(logFilePath, 'utf-8'),
    steps,
    published,
    jsonReport: jsonReport || {
      artifacts: [],
      flow: { flowId: '', repoHash: '', startFlowMs: 0 },
      steps: [],
      flowExecutionStatus: ExecutionStatus.done,
      flowResult: {
        durationMs: 0,
        errors: [],
        executionStatus: ExecutionStatus.done,
        notes: [],
        status: Status.passed,
      },
      stepsResultOfArtifactsByArtifact: [],
      stepsResultOfArtifactsByStep: [],
    },
    passed,
  }
}

type CreateRepoOptions<TaskQueue extends TaskQueueBase<unknown>> = {
  repo: Repo
  configurations?: Partial<Config<TaskQueue>>
  dontAddReportSteps?: boolean
  logLevel?: LogLevel
}

export type CreateRepo = <TaskQueue extends TaskQueueBase<unknown>>(
  options: CreateRepoOptions<TaskQueue> | ((toActualName: ToActualName) => CreateRepoOptions<TaskQueue>),
) => Promise<{
  repoPath: string
  gitHeadCommit: () => Promise<string>
  getImageTags: (packageName: string) => Promise<string[]>
  runCi: (options?: { processEnv?: NodeJS.ProcessEnv }) => Promise<RunCiResult>
  toActualName: ToActualName
}>

const createRepo: CreateRepo = async options => {
  const resourcesNamesPostfix = chance().hash().slice(0, 8)

  const toActualName = (name: string): string =>
    name.endsWith(`-${resourcesNamesPostfix}`) ? name : `${name}-${resourcesNamesPostfix}`
  const toOriginalName = (name: string) => toActualName(name).replace(`-${resourcesNamesPostfix}`, '')

  const { repo, configurations = {}, dontAddReportSteps, logLevel = LogLevel.trace } =
    typeof options === 'function' ? options(toActualName) : options

  const { gitServer } = getResources()

  const { repoPath } = await createGitRepo({
    repo,
    gitServer,
    toActualName,
    gitIgnoreFiles: ['nc.log'],
  })

  const testLogger = await winstonLogger({
    customLogLevel: logLevel,
    disabled: false,
    logFilePath: path.join(repoPath, 'nc-test.log'),
  }).callInitializeLogger({ repoPath })

  const getImageTags = async (packageName: string): Promise<string[]> => {
    return listTags({
      registry: getResources().dockerRegistry,
      dockerOrg: getResources().quayNamespace,
      repo: toActualName(packageName),
    })
  }

  const logFilePath = path.join(repoPath, 'nc.log')

  const finalConfigurations = config({
    logger:
      configurations.logger ||
      winstonLogger({
        customLogLevel: logLevel,
        disabled: false,
        logFilePath,
      }),
    keyValueStore:
      configurations.keyValueStore ||
      redisConnection({
        redisServerUri: getResources().redisServerUri,
      }),
    taskQueues: [
      localSequentalTaskQueue(),
      ...(configurations.taskQueues?.filter(t => t.taskQueueName !== localSequentalTaskQueue().taskQueueName) || []),
    ],
    steps: dontAddReportSteps ? configurations.steps || [] : addReportToStepsAsLastNodes(configurations.steps),
  })

  return {
    repoPath,
    gitHeadCommit: () => execa.command(`git rev-parse HEAD`, { stdio: 'pipe', cwd: repoPath }).then(r => r.stdout),
    toActualName,
    getImageTags,
    runCi: runCi({
      testLogger,
      repoPath,
      toOriginalName,
      getResources,
      configurations: finalConfigurations,
      logFilePath,
      stepsDontContainReport: Boolean(dontAddReportSteps),
    }),
  }
}

function beforeAfterCleanups() {
  const cleanups: Cleanup[] = []
  beforeEach(async () => {
    cleanups.splice(0, cleanups.length)
  })
  afterEach(async () => {
    await Promise.allSettled(cleanups.map(f => f()))
  })
  return cleanups
}

const sleep = (cleanups: Cleanup[]) => (ms: number): Promise<void> => {
  return new Promise(res => {
    const id = setTimeout(res, ms)
    cleanups.push(async () => {
      clearTimeout(id)
      res()
    })
  })
}

export function createTest(): {
  getResources: () => TestResources
  createRepo: CreateRepo
  sleep: (ms: number) => Promise<void>
} {
  const cleanups = beforeAfterCleanups()
  return { getResources, createRepo, sleep: sleep(cleanups) }
}
