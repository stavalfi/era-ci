import { ci, config, Config, connectToRedis, createImmutableCache, Logger, LogLevel, TaskQueueBase } from '@era-ci/core'
import { listTags } from '@era-ci/image-registry-client'
import { winstonLogger } from '@era-ci/loggers'
import { JsonReport, jsonReporter, jsonReporterCacheKey, stringToJsonReport } from '@era-ci/steps'
import { localSequentalTaskQueue } from '@era-ci/task-queues'
import { ExecutionStatus, Status } from '@era-ci/utils'
import anyTest, { ExecutionContext } from 'ava'
import chance from 'chance'
import execa from 'execa'
import fse from 'fs-extra'
import path from 'path'
import { createGitRepo } from './create-git-repo'
import { resourcesBeforeAfterAll } from './prepare-test-resources'
import { getPublishResult } from './seach-targets'
import { Cleanup, CreateRepo, RunCiResult, TestWithContext, TestWithContextType } from './types'
import { addReportToStepsAsLastNodes } from './utils'

export const test = anyTest as TestWithContext

export { createGitRepo } from './create-git-repo'
export { DeepPartial, TestResources, TestWithContextType, CreateRepo } from './types'
export { isDeepSubset } from './utils'
export { resourcesBeforeAfterAll } from './prepare-test-resources'

const getJsonReport = async ({
  flowId,
  repoHash,
  jsonReportStepId,
  testLogger,
  t,
}: {
  flowId: string
  repoHash: string
  jsonReportStepId: string
  testLogger: Logger
  t: ExecutionContext<TestWithContextType>
}): Promise<JsonReport> => {
  const redisClient = await connectToRedis({
    config: {
      url: t.context.resources.redisServerUrl,
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const runCi = <TaskQueue extends TaskQueueBase<any, any>>({
  repoPath,
  configurations,
  logFilePath,
  stepsDontContainReport,
  toOriginalName,
  t,
  testLogger,
}: {
  repoPath: string
  configurations: Config<TaskQueue>
  logFilePath: string
  stepsDontContainReport: boolean
  toOriginalName: (artifactName: string) => string
  t: ExecutionContext<TestWithContextType>
  testLogger: Logger
}) => async (options?: { processEnv?: NodeJS.ProcessEnv }): Promise<RunCiResult> => {
  const processEnv: NodeJS.ProcessEnv = {
    ...t.context.processEnv,
    ...options?.processEnv,
  }
  const { flowId, repoHash, steps, passed, fatalError } = await ci({
    repoPath,
    config: configurations,
    processEnv,
    customLog: t.log.bind(t),
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
      t,
      testLogger,
      flowId,
      repoHash,
      jsonReportStepId:
        jsonReportStepId || `we will never be here. this default value is here only because of typescript.`,
    }))

  const published = await getPublishResult({
    t,
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
  }
}

export const createRepo: CreateRepo = async (t, options) => {
  const resourcesNamesPostfix = chance().hash().slice(0, 8)

  const toActualName = (name: string): string =>
    name.endsWith(`-${resourcesNamesPostfix}`) ? name : `${name}-${resourcesNamesPostfix}`
  const toOriginalName = (name: string) => toActualName(name).replace(`-${resourcesNamesPostfix}`, '')

  const { repo, configurations = {}, dontAddReportSteps, logLevel = LogLevel.trace } =
    typeof options === 'function' ? options(toActualName) : options

  const { gitServer } = t.context.resources

  const { repoPath } = await createGitRepo({
    repo,
    gitServer,
    toActualName,
    gitIgnoreFiles: ['era-ci.log', 'era-ci-test.log'],
  })

  const testLogger = await winstonLogger({
    customLogLevel: logLevel,
    disabled: false,
    logFilePath: path.join(repoPath, 'era-ci-test.log'),
  }).callInitializeLogger({ repoPath, customLog: t.log.bind(t) })

  const getImageTags = async (packageName: string): Promise<string[]> => {
    return listTags({
      registry: t.context.resources.dockerRegistry,
      dockerOrg: t.context.resources.quayNamespace,
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
      url: t.context.resources.redisServerUrl,
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
    runCi: runCi({
      t,
      testLogger,
      repoPath,
      toOriginalName,
      configurations: finalConfigurations,
      logFilePath,
      stepsDontContainReport: Boolean(dontAddReportSteps),
    }),
  }
}

function beforeAfterCleanups(test: TestWithContext) {
  test.serial.beforeEach(async t => {
    t.context.cleanups = []
  })
  test.serial.afterEach(async t => {
    await Promise.allSettled(t.context.cleanups.map(f => f()))
  })
}

export const sleep = (cleanups: Cleanup[]) => (ms: number): Promise<void> => {
  return new Promise(res => {
    const id = setTimeout(res, ms)
    cleanups.push(async () => {
      clearTimeout(id)
      res()
    })
  })
}

export function createTest(
  test: TestWithContext,
  options?: {
    startQuayHelperService?: boolean
    startQuayMockService?: boolean
  },
): void {
  resourcesBeforeAfterAll(test, options)
  beforeAfterCleanups(test)
  test.serial.beforeEach(t => {
    t.timeout(50 * 1000)
    t.context.sleep = sleep(t.context.cleanups)
    t.context.createRepo = createRepo
  })
}
