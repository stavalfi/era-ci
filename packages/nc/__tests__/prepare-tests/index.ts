/// <reference path="../../../../declarations.d.ts" />

import chance from 'chance'
import {
  cliTableReporter,
  Config,
  CreateCache,
  createLinearStepsGraph,
  CreateLogger,
  Graph,
  JsonReport,
  jsonReporter,
  jsonReporterCacheKey,
  LogLevel,
  redisWithNodeCache,
  Step,
  StepInfo,
  stringToJsonReport,
  winstonLogger,
} from '../../src'
import { ci } from '../../src/ci-logic'
import { createGitRepo } from './create-git-repo'
import { resourcesBeforeAfterAll } from './prepare-test-resources'
import { Repo, TestResources } from './types'

export { isDeepSubsetOf, isDeepSubsetOfOrPrint } from './utils'
export { DeepPartial } from './types'

const { getResoureces } = resourcesBeforeAfterAll()

const getJsonReport = async ({
  flowId,
  createCache,
  createLogger,
  repoPath,
  jsonReportStepId,
}: {
  flowId: string
  createCache: CreateCache
  createLogger: CreateLogger
  repoPath: string
  jsonReportStepId: string
}): Promise<JsonReport> => {
  const logger = await createLogger.callInitializeLogger({ repoPath })
  const cache = await createCache.callInitializeCache({ flowId, log: logger.createLog('test-logger'), artifacts: [] })

  try {
    const jsonReportResult = await cache.get(jsonReporterCacheKey({ flowId, stepId: jsonReportStepId }), r => {
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
    await cache.cleanup()
  }
}

type RunCi = (
  config?: Partial<Omit<Config, 'steps'> & { steps?: Step[] }>,
) => Promise<{
  flowId: string
  steps: Graph<{ stepInfo: StepInfo }>
  jsonReport: JsonReport
  passed: boolean
}>

const runCi = ({ repoPath }: { repoPath: string }): RunCi => async (config = {}) => {
  const defaultLogger = winstonLogger({
    customLogLevel: LogLevel.verbose,
    disabled: false,
    logFilePath: './nc.log',
  })
  const defaultCache = redisWithNodeCache({
    redis: {
      redisServer: getResoureces().redisServer,
    },
  })
  const defaultJsonReport = jsonReporter()
  const defaultCliTableReport = cliTableReporter()
  const finalConfig: Config = {
    logger: config.logger || defaultLogger,
    cache: config.cache || defaultCache,
    steps: createLinearStepsGraph([...(config.steps || []), defaultJsonReport, defaultCliTableReport]),
  }
  const { flowId, steps, passed } = await ci({
    repoPath,
    config: finalConfig,
  })

  if (!flowId) {
    throw new Error(`ci didn't return flow-id. can't find json-report`)
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
    createCache: defaultCache,
    createLogger: defaultLogger,
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
