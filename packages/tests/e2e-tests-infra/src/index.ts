import {
  ci,
  config,
  Config,
  connectToRedis,
  createImmutableCache,
  Logger,
  LogLevel,
  RedisFlowEvent,
  TaskQueueBase,
} from '@era-ci/core'
import { listTags } from '@era-ci/image-registry-client'
import { winstonLogger } from '@era-ci/loggers'
import { JsonReport, jsonReporter, jsonReporterCacheKey, stringToJsonReport } from '@era-ci/steps'
import { localSequentalTaskQueue } from '@era-ci/task-queues'
import { ExecutionStatus, Status } from '@era-ci/utils'
import chance from 'chance'
import execa from 'execa'
import fse from 'fs-extra'
import path from 'path'
import { createGitRepo } from './create-git-repo'
import { resourcesBeforeAfterEach } from './prepare-test-resources'
import { getPublishResult } from './seach-targets'
import { Cleanup, CreateRepo, RunCiResult, TestFuncs, TestProcessEnv } from './types'
import { addReportToStepsAsLastNodes } from './utils'

export { createGitRepo } from './create-git-repo'
export { resourcesBeforeAfterEach } from './prepare-test-resources'
export { CreateRepo, DeepPartial, TestResources, TestWithContextType, TestFuncs } from './types'
export { isDeepSubset } from './utils'

const getJsonReport = (testFuncs: TestFuncs) => async ({
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
  const redisClient = await connectToRedis({
    config: {
      url: testFuncs.getResources().redisServerUrl,
    },
    logger: testLogger,
  })
  const immutableCache = await createImmutableCache({
    artifacts: [],
    flowId,
    repoHash,
    log: testLogger.createLog('cache'),
    redisClient,
    ttls: {
      ArtifactStepResult: 1000 * 60 * 60 * 24 * 7,
      flowLogs: 1000 * 60 * 60 * 24 * 7,
    },
  })
  try {
    const jsonReportResult = await immutableCache.get({
      key: jsonReporterCacheKey({ flowId, stepId: jsonReportStepId }),
      isBuffer: true,
      mapper: r => {
        if (typeof r === 'string') {
          return stringToJsonReport({ jsonReportAsString: r })
        } else {
          throw new Error(
            `invalid value in cache. expected the type to be: string, acutal-type: ${typeof r}. actual value: ${r}`,
          )
        }
      },
    })
    if (!jsonReportResult) {
      throw new Error(`can't find json-report in the cache. failing test`)
    }
    return jsonReportResult.value
  } finally {
    await immutableCache.cleanup()
    await redisClient.cleanup()
  }
}

type RunCiOptions = {
  repoPath: string
  configurations: Config<TaskQueueBase<any, any>>
  logFilePath: string
  stepsDontContainReport: boolean
  toOriginalName: (artifactName: string) => string
  testLogger: Logger
}

const runCi = (testFuncs: TestFuncs) => ({
  repoPath,
  configurations,
  logFilePath,
  stepsDontContainReport,
  toOriginalName,
  testLogger,
}: RunCiOptions) => async (options?: { processEnv?: NodeJS.ProcessEnv }): Promise<RunCiResult> => {
  const flowEvents: RedisFlowEvent[] = []
  testFuncs
    .getResources()
    .redisFlowEventsSubscriptionsConnection.on('message', (_topic: string, eventString: string) =>
      flowEvents.push(JSON.parse(eventString)),
    )

  const { flowId, repoHash, steps, passed, fatalError } = await ci({
    repoPath,
    config: configurations,
    processEnv: {
      ...testFuncs.getProcessEnv(),
      ...options?.processEnv,
    },
  })

  flowEvents.sort((e1, e2) => e1.eventTs - e2.eventTs) // [1,2,3]

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
    (await getJsonReport(testFuncs)({
      testLogger,
      flowId,
      repoHash,
      jsonReportStepId:
        jsonReportStepId || `we will never be here. this default value is here only because of typescript.`,
    }))

  const published = await getPublishResult(testFuncs)({
    testLogger,
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
    flowEvents,
  }
}

export const createRepo = (testFuncs: TestFuncs): CreateRepo => async options => {
  const resourcesNamesPostfix = chance().hash().slice(0, 8)

  const toActualName = (name: string): string =>
    name.endsWith(`-${resourcesNamesPostfix}`) ? name : `${name}-${resourcesNamesPostfix}`
  const toOriginalName = (name: string) => toActualName(name).replace(`-${resourcesNamesPostfix}`, '')

  const { repo, configurations = {}, dontAddReportSteps, logLevel = LogLevel.trace } =
    typeof options === 'function' ? options(toActualName) : options

  const { repoPath } = await createGitRepo({
    repo,
    gitServer: testFuncs.getResources().gitServer,
    toActualName,
    gitIgnoreFiles: ['era-ci.log', 'era-ci-test.log'],
  })

  const testLogger = await winstonLogger({
    customLogLevel: LogLevel.trace,
    disabled: false,
    logFilePath: path.join(repoPath, 'era-ci-test.log'),
  }).callInitializeLogger({
    repoPath,
  })

  const getImageTags = async (packageName: string): Promise<string[]> => {
    return listTags({
      registry: testFuncs.getResources().dockerRegistry,
      dockerOrg: testFuncs.getResources().quayNamespace,
      repo: toActualName(packageName),
    })
  }

  const logFilePath = path.join(repoPath, 'era-ci.log')

  const finalConfigurations = config({
    logger:
      configurations.logger ||
      winstonLogger({
        customLogLevel: logLevel,
        disabled: false,
        logFilePath,
      }),
    redis: configurations.redis || {
      url: testFuncs.getResources().redisServerUrl,
    },
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
    runCi: runCi(testFuncs)({
      testLogger,
      repoPath,
      toOriginalName,
      configurations: finalConfigurations,
      logFilePath,
      stepsDontContainReport: Boolean(dontAddReportSteps),
    }),
  }
}

function beforeAfterCleanups(): () => Cleanup[] {
  let cleanups: Cleanup[]
  beforeEach(async () => {
    cleanups = []
  })
  afterEach(async () => {
    // eslint-disable-next-line no-console
    console.log(`finished test - cleaning up ${cleanups.length} resources`)
    await Promise.allSettled(cleanups.map(f => f()))
  })
  return () => cleanups
}

export const sleep = (getCleanups: () => Cleanup[]) => (ms: number): Promise<void> => {
  return new Promise(res => {
    const id = setTimeout(res, ms)
    getCleanups().push(async () => {
      clearTimeout(id)
      res()
    })
  })
}

function processEnvBeforeAfterEach(): () => TestProcessEnv {
  let processEnv: TestProcessEnv
  beforeEach(async () => {
    processEnv = {
      NC_TEST_MODE: 'true',
      SKIP_EXIT_CODE_1: 'true',
      QUAY_BUILD_STATUS_CHANED_TEST_REDIS_TOPIC: `redis-topic-${chance().hash().slice(0, 8)}`,
      ERA_CI_EVENTS_TOPIC_PREFIX: `redis-topic-${chance().hash().slice(0, 8)}`,
    }
  })

  return () => processEnv
}

const createTestLogger = async (repoPath: string) =>
  winstonLogger({
    customLogLevel: LogLevel.trace,
    disabled: false,
    logFilePath: path.join(repoPath, `era-ci-test.log`),
  }).callInitializeLogger({
    repoPath,
  })

export function createTest(options?: {
  startQuayHelperService?: boolean
  startQuayMockService?: boolean
}): TestFuncs & { createRepo: CreateRepo } {
  const getCleanups = beforeAfterCleanups()
  const getProcessEnv = processEnvBeforeAfterEach()
  const getResources = resourcesBeforeAfterEach({
    ...options,
    getProcessEnv,
    getCleanups,
  })

  const testFuncs: TestFuncs = {
    sleep: sleep(getCleanups),
    getProcessEnv,
    getResources,
    getCleanups,
    createTestLogger,
  }

  return {
    ...testFuncs,
    createRepo: createRepo(testFuncs),
  }
}
