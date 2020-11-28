import chance from 'chance'
import path from 'path'
import {
  ci,
  config,
  Config,
  createImmutableCache,
  ExecutionStatus,
  Graph,
  JsonReport,
  jsonReporter,
  jsonReporterCacheKey,
  localSequentalTaskQueue,
  LogLevel,
  redisConnection,
  Status,
  StepInfo,
  stringToJsonReport,
  TaskQueueBase,
  winstonLogger,
} from '@tahini/nc'
import { createGitRepo } from './create-git-repo'
import { resourcesBeforeAfterAll } from './prepare-test-resources'
import { Repo, TestResources } from './types'
import { addReportToStepsAsLastNodes } from './utils'
import fse from 'fs-extra'

export { DeepPartial, TestResources } from './types'
export { isDeepSubsetOf, isDeepSubsetOfOrPrint, sleep } from './utils'
export { createGitRepo } from './create-git-repo'

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
    redisServerUri: getResoureces().redisServerUri,
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
      throw new Error(`can't find json-report in the cache. failing test`)
    }
    return jsonReportResult.value
  } finally {
    await keyValueStoreConnection.cleanup()
    await immutableCache.cleanup()
  }
}

type RunCi = <TaskQueue extends TaskQueueBase<unknown>>(
  config?: Partial<Config<TaskQueue>>,
  options?: {
    dontAddReportSteps?: boolean
  },
) => Promise<{
  flowId: string
  steps: Graph<{ stepInfo: StepInfo }>
  jsonReport: JsonReport
  passed: boolean
  logFilePath: string
  flowLogs: string
}>

const runCi = ({ repoPath }: { repoPath: string }): RunCi => async (configurations = {}, options) => {
  const logFilePath = path.join(repoPath, 'nc.log')
  const { flowId, repoHash, steps, passed, fatalError } = await ci({
    repoPath,
    config: config({
      logger:
        configurations.logger ||
        winstonLogger({
          customLogLevel: LogLevel.verbose,
          disabled: false,
          logFilePath,
        }),
      keyValueStore:
        configurations.keyValueStore ||
        redisConnection({
          redisServerUri: getResoureces().redisServerUri,
        }),
      taskQueues: configurations.taskQueues || [localSequentalTaskQueue()],
      steps: options?.dontAddReportSteps
        ? configurations.steps || []
        : addReportToStepsAsLastNodes(configurations.steps),
    }),
  })

  if (!repoHash) {
    throw new Error(`ci didn't return repo-hash. it looks like a bug`)
  }

  if (!steps) {
    throw new Error(`ci didn't return steps-graph. can't find json-report`)
  }
  const jsonReportStepId = steps.find(s => s.data.stepInfo.stepName === jsonReporter().stepName)?.data.stepInfo.stepId
  if (!fatalError && !options?.dontAddReportSteps && !jsonReportStepId) {
    throw new Error(`can't find jsonReportStepId. can't find json-report`)
  }

  const jsonReport =
    !fatalError &&
    !options?.dontAddReportSteps &&
    (await getJsonReport({
      repoPath,
      flowId,
      repoHash,
      jsonReportStepId:
        jsonReportStepId || `we will never be here. this default value is here only because of typescript.`,
    }))

  return {
    flowId,
    logFilePath,
    flowLogs: await fse.readFile(logFilePath, 'utf-8'),
    steps,
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

export type CreateRepo = (
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