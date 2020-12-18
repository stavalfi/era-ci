import { ci, config, Config, createImmutableCache, LogLevel, StepInfo, TaskQueueBase } from '@tahini/core'
import { localSequentalTaskQueue } from '@tahini/task-queues'
import { redisConnection } from '@tahini/key-value-stores'
import { winstonLogger } from '@tahini/loggers'
import { ExecutionStatus, Graph, Status } from '@tahini/utils'
import {
  getDockerImageLabelsAndTags,
  JsonReport,
  jsonReporter,
  jsonReporterCacheKey,
  stringToJsonReport,
} from '@tahini/steps'
import chance from 'chance'
import fse from 'fs-extra'
import path from 'path'
import { createGitRepo } from './create-git-repo'
import { resourcesBeforeAfterAll } from './prepare-test-resources'
import { Repo, TestResources } from './types'
import { addReportToStepsAsLastNodes } from './utils'

export { createGitRepo } from './create-git-repo'
export { DeepPartial, TestResources } from './types'
export { isDeepSubset, sleep } from './utils'

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
    customLogLevel: LogLevel.trace,
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

type RunCi = () => Promise<{
  flowId: string
  steps: Graph<{ stepInfo: StepInfo }>
  jsonReport: JsonReport
  passed: boolean
  logFilePath: string
  flowLogs: string
}>

const runCi = <TaskQueue extends TaskQueueBase<unknown>>({
  repoPath,
  configurations,
  logFilePath,
  stepsDontContainReport,
}: {
  repoPath: string
  configurations: Config<TaskQueue>
  logFilePath: string
  stepsDontContainReport: boolean
}): RunCi => async () => {
  const { flowId, repoHash, steps, passed, fatalError } = await ci({
    repoPath,
    config: configurations,
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

export type CreateRepo = <TaskQueue extends TaskQueueBase<unknown>>(options: {
  repo: Repo
  configurations?: Partial<Config<TaskQueue>>
  dontAddReportSteps?: boolean
}) => Promise<{
  repoPath: string
  getImageTags: (packageName: string) => Promise<string[]>
  runCi: RunCi
  toActualName: (packageName: string) => string
}>

const createRepo: CreateRepo = async ({ repo, configurations = {}, dontAddReportSteps }) => {
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

  const logger = await winstonLogger({
    customLogLevel: LogLevel.trace,
    disabled: false,
    logFilePath: './nc.log',
  }).callInitializeLogger({ repoPath })

  const getImageTags = async (packageName: string): Promise<string[]> => {
    const result = await getDockerImageLabelsAndTags({
      dockerOrganizationName: getResoureces().quayNamespace,
      imageName: toActualName(packageName),
      dockerRegistry: getResoureces().dockerRegistry,
      repoPath,
      log: logger.createLog('test'),
      silent: true,
    })
    return result?.allValidTagsSorted || []
  }

  const logFilePath = path.join(repoPath, 'nc.log')

  const finalConfigurations = config({
    logger:
      configurations.logger ||
      winstonLogger({
        customLogLevel: LogLevel.trace,
        disabled: false,
        logFilePath,
      }),
    keyValueStore:
      configurations.keyValueStore ||
      redisConnection({
        redisServerUri: getResoureces().redisServerUri,
      }),
    taskQueues: [
      localSequentalTaskQueue(),
      ...(configurations.taskQueues?.filter(t => t.taskQueueName !== localSequentalTaskQueue().taskQueueName) || []),
    ],
    steps: dontAddReportSteps ? configurations.steps || [] : addReportToStepsAsLastNodes(configurations.steps),
  })

  return {
    repoPath,
    toActualName,
    getImageTags,
    runCi: runCi({
      repoPath,
      configurations: finalConfigurations,
      logFilePath,
      stepsDontContainReport: Boolean(dontAddReportSteps),
    }),
  }
}

export function createTest(): {
  getResoureces: () => TestResources
  createRepo: CreateRepo
} {
  return { getResoureces, createRepo }
}
