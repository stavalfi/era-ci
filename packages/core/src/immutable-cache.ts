import { AbortResult, Artifact, DoneResult, ExecutionStatus, Graph, Status } from '@era-ci/utils'
import _ from 'lodash'
import NodeCache from 'node-cache'
import { array, enums, number, object, optional, string, type, validate } from 'superstruct'
import { Log } from './create-logger'
import { RedisClient } from './redis-client'

export type ImmutableCache = {
  step: {
    didStepRun: (options: { stepId: string; artifactHash: string }) => Promise<boolean>
    getArtifactStepResult: (options: {
      stepId: string
      artifactHash: string
    }) => Promise<
      | {
          flowId: string
          repoHash: string
          artifactStepResult: DoneResult | AbortResult<Status.skippedAsFailed | Status.skippedAsPassed | Status.failed>
        }
      | undefined
    >
    setArtifactStepResultResipe: (options: {
      stepId: string
      artifactHash: string
      artifactStepResult: DoneResult | AbortResult<Status.skippedAsFailed | Status.skippedAsPassed | Status.failed>
    }) => ['set', string, string, 'ex', string, 'nx']
    getStepResult: (options: {
      stepId: string
    }) => Promise<
      | {
          flowId: string
          repoHash: string
          stepResult: DoneResult | AbortResult<Status.skippedAsFailed | Status.skippedAsPassed | Status.failed>
        }
      | undefined
    >
    setStepResultResipe: (options: {
      stepId: string
      stepResult: DoneResult | AbortResult<Status.skippedAsFailed | Status.skippedAsPassed | Status.failed>
    }) => ['set', string, string, 'ex', string, 'nx']
  }
  get: <T>(options: {
    key: string
    isBuffer: boolean
    mapper: (result: unknown) => T
  }) => Promise<{ flowId: string; repoHash: string; value: T } | undefined>
  set: (options: { key: string; value: string; asBuffer: boolean; ttl: number }) => Promise<void>
  has: (key: string) => Promise<boolean>
  ttls: {
    ArtifactStepResult: number
    flowLogs: number
  }
  cleanup: () => Promise<unknown>
}

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
  const nodeCache = new NodeCache()

  async function set(options: { key: string; value: string; asBuffer: boolean; ttl: number }): Promise<void> {
    const stirgifiedValue = JSON.stringify({
      flowId,
      repoHash,
      value: options.value,
    })

    await redisClient.set({
      allowOverride: false,
      key: options.key,
      ttl: options.ttl,
      value: stirgifiedValue,
      asBuffer: options.asBuffer,
    })
    nodeCache.set(options.key, stirgifiedValue)
  }

  const getResultSchema = object({
    flowId: string(),
    repoHash: string(),
    value: string(),
  })

  async function get<T>({
    key,
    isBuffer,
    mapper,
  }: {
    key: string
    isBuffer: boolean
    mapper: (result: string) => T
  }): Promise<{ flowId: string; repoHash: string; value: T } | undefined> {
    const strigifiedJson = nodeCache.get<string>(key) ?? (await redisClient.get({ key, isBuffer, mapper: _.identity }))
    if (strigifiedJson === undefined) {
      return undefined
    }
    const [error, parsedResult] = validate(JSON.parse(strigifiedJson), getResultSchema)
    if (parsedResult) {
      return {
        flowId: parsedResult.flowId,
        repoHash: parsedResult.repoHash,
        value: mapper(parsedResult.value),
      }
    } else {
      throw new Error(
        `(1) cache.get returned a data with an invalid schema. validation-error: "${error}". data: "${strigifiedJson}"`,
      )
    }
  }

  async function has(key: string): Promise<boolean> {
    return nodeCache.has(key) || (await redisClient.has(key))
  }

  function toArtifactStepResultKey({ artifactHash, stepId }: { stepId: string; artifactHash: string }) {
    return `${stepId}-${artifactHash}`
  }

  function toStepResultKey({ repoHash, stepId }: { repoHash: string; stepId: string }) {
    return `${repoHash}-${stepId}`
  }

  const resultSchema = object({
    executionStatus: enums([ExecutionStatus.done, ExecutionStatus.aborted]),
    status: enums(Object.values(Status)),
    durationMs: optional(number()),
    returnValue: optional(string()),
    notes: array(string()),
    errors: array(
      type({
        name: optional(string()),
        stack: optional(string()),
        message: optional(string()),
        code: optional(string()),
      }),
    ),
  })

  const step: ImmutableCache['step'] = {
    didStepRun: options => has(toArtifactStepResultKey({ stepId: options.stepId, artifactHash: options.artifactHash })),
    getArtifactStepResult: async ({ stepId, artifactHash }) => {
      const artifactStepResult = await get({
        key: toArtifactStepResultKey({ stepId, artifactHash }),
        isBuffer: false,
        mapper: r => {
          if (typeof r !== 'string') {
            throw new Error(
              `(2) cache.get returned a data with an invalid type. expected string, actual: "${typeof r}". data: "${r}"`,
            )
          }

          const [error, parsedResult] = validate(JSON.parse(r), resultSchema)
          if (parsedResult) {
            return parsedResult
          } else {
            throw new Error(
              `(3) cache.get returned a data with an invalid schema. validation-error: "${error}". data: "${r}"`,
            )
          }
        },
      })
      if (!artifactStepResult) {
        return undefined
      }

      return {
        flowId: artifactStepResult.flowId,
        repoHash: artifactStepResult.repoHash,
        artifactStepResult: artifactStepResult.value as
          | DoneResult
          | AbortResult<Status.skippedAsFailed | Status.skippedAsPassed | Status.failed>,
      }
    },
    setArtifactStepResultResipe: ({ artifactHash, stepId, artifactStepResult }) => {
      return [
        'set',
        toArtifactStepResultKey({ stepId, artifactHash }),
        JSON.stringify({
          flowId,
          repoHash,
          value: JSON.stringify(artifactStepResult),
        }),
        'ex',
        ttls.ArtifactStepResult.toString(),
        'nx',
      ]
    },
    getStepResult: async ({ stepId }) => {
      const stepResult = await get({
        key: toStepResultKey({ stepId, repoHash }),
        isBuffer: false,
        mapper: r => {
          if (typeof r !== 'string') {
            throw new Error(
              `(2) cache.get returned a data with an invalid type. expected string, actual: "${typeof r}". data: "${r}"`,
            )
          }

          const [error, parsedResult] = validate(JSON.parse(r), resultSchema)
          if (parsedResult) {
            return parsedResult
          } else {
            throw new Error(
              `(3) cache.get returned a data with an invalid schema. validation-error: "${error}". data: "${r}"`,
            )
          }
        },
      })
      if (!stepResult) {
        return undefined
      }

      return {
        flowId: stepResult.flowId,
        repoHash: stepResult.repoHash,
        stepResult: stepResult.value as
          | DoneResult
          | AbortResult<Status.skippedAsFailed | Status.skippedAsPassed | Status.failed>,
      }
    },
    setStepResultResipe: ({ stepId, stepResult }) => {
      return [
        'set',
        toStepResultKey({ stepId, repoHash }),
        JSON.stringify({
          flowId,
          repoHash,
          value: JSON.stringify(stepResult),
        }),
        'ex',
        ttls.ArtifactStepResult.toString(),
        'nx',
      ]
    },
  }

  const cleanup = async () => {
    await nodeCache.close()
    log.debug(`closed node-cache`)
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
