import { AbortResult, Artifact, DoneResult, ExecutionStatus, Graph, Result, Status } from '@era-ci/utils'
import _ from 'lodash'
import { object, string, validate } from 'superstruct'
import { Log } from './create-logger'
import { RedisClient } from './redis-client'

export type ArtifactStepCacheResult<R extends Result> = {
  flowId: string
  repoHash: string
  artifactStepResult: R
}

export type StepCacheResult<R extends Result> = {
  flowId: string
  repoHash: string
  stepResult: R
}

export type ArtifactStepResults = {
  all: ArtifactStepCacheResult<Result>[]
  passed: ArtifactStepCacheResult<DoneResult<Status.passed>>[]
  skippedAsPassed: ArtifactStepCacheResult<AbortResult<Status.skippedAsPassed>>[]
  skippedAsFailed: ArtifactStepCacheResult<AbortResult<Status.skippedAsFailed>>[]
  failed: ArtifactStepCacheResult<DoneResult<Status.failed> | AbortResult<Status.failed>>[]
}

export type StepResults = {
  all: StepCacheResult<Result>[]
  passed: StepCacheResult<DoneResult<Status.passed>>[]
  skippedAsPassed: StepCacheResult<AbortResult<Status.skippedAsPassed>>[]
  skippedAsFailed: StepCacheResult<AbortResult<Status.skippedAsFailed>>[]
  failed: StepCacheResult<DoneResult<Status.failed> | AbortResult<Status.failed>>[]
}

export type ImmutableCache = {
  step: {
    getArtifactStepResults: (options: { stepId: string; artifactHash: string }) => Promise<ArtifactStepResults>
    setArtifactStepResultResipe: (options: {
      stepId: string
      artifactHash: string
      artifactStepResult: Result
    }) => [['sadd', string, string], ['expire', string, string]]
    getStepResults: (options: { stepId: string }) => Promise<StepResults>
    setStepResultResipe: (options: {
      stepId: string
      stepResult: Result
    }) => [['sadd', string, string], ['expire', string, string]]
  }
  get: <T>(options: {
    key: string
    isBuffer: boolean
    mapper: (result: unknown) => T
  }) => Promise<{ flowId: string; repoHash: string; value: T } | undefined>
  set: (options: { key: string; value: string; asBuffer: boolean; ttl: number }) => Promise<void>
  has: (key: string) => Promise<boolean>
  ttls: {
    ArtifactStepResults: number
    flowLogs: number
  }
  cleanup: () => Promise<unknown>
}

const getResultSchema = object({
  flowId: string(),
  repoHash: string(),
  value: string(),
})

export async function createImmutableCache({
  repoHash,
  flowId,
  redisClient,
  log,
  ttls,
}: {
  redisClient: RedisClient
  flowId: string
  repoHash: string
  log: Log
  artifacts: Graph<{ artifact: Artifact }>
  ttls: ImmutableCache['ttls']
}): Promise<ImmutableCache> {
  const toFlowValueString = (value: string) =>
    // TODO: add runtime types check here
    JSON.stringify({ flowId, repoHash, value })
  const toFlowValueJson = (value: string) => {
    const [error, parsedResult] = validate(JSON.parse(value), getResultSchema)
    if (parsedResult) {
      return {
        flowId: parsedResult.flowId,
        repoHash: parsedResult.repoHash,
        value: parsedResult.value,
      }
    } else {
      throw new Error(
        `(1) cache.get returned a data with an invalid schema. validation-error: "${error}". data: "${value}"`,
      )
    }
  }

  async function set(options: { key: string; value: string; asBuffer: boolean; ttl: number }): Promise<void> {
    await redisClient.set({
      allowOverride: false,
      key: options.key,
      ttl: options.ttl,
      value: toFlowValueString(options.value),
      asBuffer: options.asBuffer,
    })
  }

  async function get<T>({
    key,
    isBuffer,
    mapper,
  }: {
    key: string
    isBuffer: boolean
    mapper: (result: string) => T
  }): Promise<{ flowId: string; repoHash: string; value: T } | undefined> {
    const strigifiedJson = await redisClient.get({ key, isBuffer, mapper: _.identity })
    if (strigifiedJson === undefined) {
      return undefined
    }
    const flowValueJson = toFlowValueJson(strigifiedJson)
    return {
      flowId: flowValueJson.flowId,
      repoHash: flowValueJson.repoHash,
      value: mapper(flowValueJson.value),
    }
  }

  async function has(key: string): Promise<boolean> {
    return redisClient.has(key)
  }

  function toArtifactStepResultsKey({ artifactHash, stepId }: { stepId: string; artifactHash: string }) {
    return `${stepId}-${artifactHash}`
  }

  function toStepResultsKey({ stepId }: { stepId: string }) {
    return `${repoHash}-${stepId}`
  }

  const step: ImmutableCache['step'] = {
    getArtifactStepResults: async ({ stepId, artifactHash }) => {
      const results = await redisClient.connection.smembers(toArtifactStepResultsKey({ stepId, artifactHash }))
      const all: ArtifactStepCacheResult<Result>[] = results.map(toFlowValueJson).map(r =>
        // TODO: add runtime types check here
        ({
          flowId: r.flowId,
          repoHash: r.repoHash,
          // TODO: add runtime types check here
          artifactStepResult: JSON.parse(r.value),
        }),
      )
      return {
        all,
        passed: all.filter(
          r =>
            r.artifactStepResult.executionStatus === ExecutionStatus.done &&
            r.artifactStepResult.status === Status.passed,
        ) as ArtifactStepCacheResult<DoneResult<Status.passed>>[],
        skippedAsPassed: all.filter(
          r =>
            r.artifactStepResult.executionStatus === ExecutionStatus.aborted &&
            r.artifactStepResult.status === Status.skippedAsPassed,
        ) as ArtifactStepCacheResult<AbortResult<Status.skippedAsPassed>>[],
        skippedAsFailed: all.filter(
          r =>
            r.artifactStepResult.executionStatus === ExecutionStatus.aborted &&
            r.artifactStepResult.status === Status.skippedAsFailed,
        ) as ArtifactStepCacheResult<AbortResult<Status.skippedAsFailed>>[],
        failed: all.filter(
          r =>
            (r.artifactStepResult.executionStatus === ExecutionStatus.done ||
              r.artifactStepResult.executionStatus === ExecutionStatus.aborted) &&
            r.artifactStepResult.status === Status.failed,
        ) as ArtifactStepCacheResult<DoneResult<Status.failed> | AbortResult<Status.failed>>[],
      }
    },
    setArtifactStepResultResipe: ({ artifactHash, stepId, artifactStepResult }) => {
      const key = toArtifactStepResultsKey({ stepId, artifactHash })
      return [
        [
          'sadd',
          key,
          // TODO: add runtime types check here
          toFlowValueString(JSON.stringify(artifactStepResult)),
        ],
        ['expire', key, ttls.ArtifactStepResults.toString()],
      ]
    },
    getStepResults: async ({ stepId }) => {
      const results = await redisClient.connection.smembers(toStepResultsKey({ stepId }))
      const all: StepCacheResult<Result>[] = results.map(toFlowValueJson).map(r =>
        // TODO: add runtime types check here
        ({
          flowId: r.flowId,
          repoHash: r.repoHash,
          // TODO: add runtime types check here
          stepResult: JSON.parse(r.value),
        }),
      )
      return {
        all,
        passed: all.filter(
          r => r.stepResult.executionStatus === ExecutionStatus.done && r.stepResult.status === Status.passed,
        ) as StepCacheResult<DoneResult<Status.passed>>[],
        skippedAsPassed: all.filter(
          r =>
            r.stepResult.executionStatus === ExecutionStatus.aborted && r.stepResult.status === Status.skippedAsPassed,
        ) as StepCacheResult<AbortResult<Status.skippedAsPassed>>[],
        skippedAsFailed: all.filter(
          r =>
            r.stepResult.executionStatus === ExecutionStatus.aborted && r.stepResult.status === Status.skippedAsFailed,
        ) as StepCacheResult<AbortResult<Status.skippedAsFailed>>[],
        failed: all.filter(
          r =>
            (r.stepResult.executionStatus === ExecutionStatus.done ||
              r.stepResult.executionStatus === ExecutionStatus.aborted) &&
            r.stepResult.status === Status.failed,
        ) as StepCacheResult<DoneResult<Status.failed> | AbortResult<Status.failed>>[],
      }
    },
    setStepResultResipe: ({ stepId, stepResult }) => {
      const key = toStepResultsKey({ stepId })
      return [
        [
          'sadd',
          key,
          // TODO: add runtime types check here
          toFlowValueString(JSON.stringify(stepResult)),
        ],
        ['expire', key, ttls.ArtifactStepResults.toString()],
      ]
    },
  }

  const cleanup = async () => {
    log.debug(`closed immutable-cache`)
  }

  return {
    step,
    get,
    has,
    set,
    cleanup,
    ttls,
  }
}
