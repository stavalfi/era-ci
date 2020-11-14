/// <reference path="../../../../declarations.d.ts" />

import chance from 'chance'
import {
  ci,
  config,
  Config,
  createImmutableCache,
  Graph,
  JsonReport,
  jsonReporter,
  jsonReporterCacheKey,
  localSequentalTaskQueue,
  LogLevel,
  redisConnection,
  StepInfo,
  stringToJsonReport,
  TaskQueueBase,
  winstonLogger,
} from '../../src'
import { createGitRepo } from './create-git-repo'
import { resourcesBeforeAfterAll } from './prepare-test-resources'
import { Repo, TestResources } from './types'

export { DeepPartial } from './types'
export { isDeepSubsetOf, isDeepSubsetOfOrPrint } from './utils'

const { getResoureces } = resourcesBeforeAfterAll()

const getJsonReport = async ({
  flowId,
  repoHash,
  repoPath,
  jsonReportStepId,
}: {
  flowId: string
  repoHash: string
  repoPath: string
  jsonReportStepId: string
}): Promise<JsonReport> => {
  const logger = await winstonLogger({
    customLogLevel: LogLevel.verbose,
    disabled: false,
    logFilePath: './nc.log',
  }).callInitializeLogger({ repoPath })
  const keyValueStoreConnection = await redisConnection({
    redisServer: getResoureces().redisServer,
  }).callInitializeKeyValueStoreConnection()
  const immutableCache = await createImmutableCache({
    artifacts: [],
    flowId,
    repoHash,
    log: logger.createLog('cache'),
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
      throw new Error(`can't find json-report in the cache. printing the report is aborted`)
    }
    return jsonReportResult.value
  } finally {
    await keyValueStoreConnection.cleanup()
    await immutableCache.cleanup()
  }
}

type RunCi = <TaskQueue extends TaskQueueBase<unknown>>(
  config?: Partial<Config<TaskQueue>>,
) => Promise<{
  flowId: string
  steps: Graph<{ stepInfo: StepInfo }>
  jsonReport: JsonReport
  passed: boolean
}>

const runCi = ({ repoPath }: { repoPath: string }): RunCi => async (configurations = {}) => {
  const logger =
    configurations.logger ||
    winstonLogger({
      customLogLevel: LogLevel.verbose,
      disabled: false,
      logFilePath: './nc.log',
    })
  const keyValueStore =
    configurations.keyValueStore ||
    redisConnection({
      redisServer: getResoureces().redisServer,
    })
  const defaultJsonReport = jsonReporter()
  const finalConfig = config({
    logger,
    keyValueStore,
    taskQueues: [localSequentalTaskQueue()],
    steps: configurations.steps || [],
  })
  const { flowId, repoHash, steps, passed } = await ci({
    repoPath,
    config: finalConfig,
  })

  if (!repoHash) {
    throw new Error(`ci didn't return repo-hash. it looks like a bug`)
  }

  if (!steps) {
    throw new Error(`ci didn't return steps-graph. can't find json-report`)
  }
  const jsonReportStepId = steps.find(s => s.data.stepInfo.stepName === defaultJsonReport.stepName)?.data.stepInfo
    .stepId
  if (!jsonReportStepId) {
    throw new Error(`can't find jsonReportStepId. can't find json-report`)
  }

  const jsonReport = await getJsonReport({
    repoPath,
    flowId,
    repoHash,
    jsonReportStepId,
  })

  return {
    flowId,
    steps,
    jsonReport,
    passed,
  }
}

type CreateRepo = (
  repo: Repo,
) => Promise<{
  repoPath: string
  runCi: RunCi
  toActualName: (packageName: string) => string
}>

const createRepo: CreateRepo = async repo => {
  const resourcesNamesPostfix = chance().hash().slice(0, 8)

  const toActualName = (name: string): string =>
    name.endsWith(`-${resourcesNamesPostfix}`) ? name : `${name}-${resourcesNamesPostfix}`

  const { gitServer } = getResoureces()

  const { repoPath } = await createGitRepo({
    repo,
    gitServer,
    toActualName,
    gitIgnoreFiles: ['nc.log'],
  })

  return {
    repoPath,
    toActualName,
    runCi: runCi({ repoPath }),
  }
}

export function createTest(): {
  getResoureces: () => TestResources
  createRepo: CreateRepo
} {
  return { getResoureces, createRepo }
}
