import Redis, { ValueType } from 'ioredis'
import NodeCache from 'node-cache'
import redisUrlParse from 'redis-url-parse'
import { any, array, enums, number, object, optional, string, type, validate } from 'superstruct'
import { promisify } from 'util'
import zlib from 'zlib'
import { Cache, createCache } from './create-cache'
import { AbortResult, DoneResult, ExecutionStatus, Status } from './types'

export type CacheConfiguration = {
  redis: {
    redisServer: string
    auth?: {
      password?: string
    }
  }
  ttls?: {
    stepSummary?: number
    flowLogs?: number
    stepResult?: number
  }
}

type NormalizedCacheConfiguration = {
  redis: {
    redisServer: {
      host: string
      port: number
    }
    auth?: {
      password?: string
    }
  }
  ttls: {
    stepSummary: number
    flowLogs: number
    stepResult: number
  }
}

async function zip(data: string): Promise<Buffer> {
  return promisify<string, Buffer>(zlib.deflate)(data)
}

async function unzip(buffer: Buffer): Promise<string> {
  const result = await promisify<Buffer, Buffer>(zlib.unzip)(buffer)
  return result.toString()
}

export const redisWithNodeCache = createCache<CacheConfiguration, NormalizedCacheConfiguration>({
  normalizeCacheConfigurations: async ({ redis, ttls }) => {
    const parsedRedisServer = redisUrlParse(redis.redisServer)
    return {
      redis: {
        ...redis,
        redisServer: {
          host: parsedRedisServer.host,
          port: parsedRedisServer.port,
        },
      },
      ttls: {
        stepSummary: ttls?.stepSummary ?? 1000 * 60 * 60 * 24 * 7, // default-ttl = 1-week
        flowLogs: ttls?.stepSummary ?? 1000 * 60 * 60 * 24 * 3, // default-ttl = 3-days
        stepResult: ttls?.stepSummary ?? 1000 * 60 * 60 * 24 * 3, // default-ttl = 3-days
      },
    }
  },
  initializeCache: async ({ cacheConfigurations, flowId, artifacts }) => {
    const nodeCache = new NodeCache()

    const redisClient = new Redis({
      host: cacheConfigurations.redis.redisServer.host,
      port: cacheConfigurations.redis.redisServer.port,
      password: cacheConfigurations.redis.auth?.password,
    })

    async function set(
      options: { key: string; value: ValueType; allowOverride: boolean } & (
        | {
            onlySaveInNodeCache: true
          }
        | { ttl: number; onlySaveInNodeCache: false }
      ),
    ): Promise<void> {
      const zippedBuffer = await zip(
        JSON.stringify({
          flowId,
          value: options.value,
        }),
      )
      nodeCache.set(options.key, zippedBuffer)
      if (!options.onlySaveInNodeCache) {
        await redisClient.set(options.key, zippedBuffer, 'px', options.ttl, options.allowOverride ? undefined : 'nx')
      }
    }

    const getResultSchema = object({
      flowId: string(),
      value: any(),
    })

    async function transformFromCache<T>(
      fromCache: Buffer | undefined | null,
      mapper: (result: unknown) => T,
    ): Promise<{ flowId: string; value: T } | undefined> {
      if (fromCache === null || fromCache === undefined) {
        return undefined
      }
      const unzipped = await unzip(fromCache)
      const [error, parsedResult] = validate(JSON.parse(unzipped), getResultSchema)
      if (parsedResult) {
        const mappedValue = mapper(parsedResult.value)
        return {
          flowId: parsedResult.flowId,
          value: mappedValue,
        }
      } else {
        throw new Error(
          `(1) cache.get returned a data with an invalid schema. validation-error: "${error}". data: "${unzipped}"`,
        )
      }
    }

    async function get<T>(
      key: string,
      mapper: (result: unknown) => T,
    ): Promise<{ flowId: string; value: T } | undefined> {
      const fromNodeCache = nodeCache.get<Buffer>(key)
      const result = await transformFromCache(fromNodeCache, mapper)
      if (result) {
        return result
      } else {
        const fromRedis = await redisClient.getBuffer(key)
        return transformFromCache(fromRedis, mapper)
      }
    }

    async function has(key: string): Promise<boolean> {
      return nodeCache.has(key) || (await redisClient.exists(key).then(result => result === 1))
    }

    function toArtifactStepResultKey({ artifactHash, stepId }: { stepId: string; artifactHash: string }) {
      return `${stepId}-${artifactHash}`
    }

    const step: Cache['step'] = {
      didStepRun: options =>
        has(toArtifactStepResultKey({ stepId: options.stepId, artifactHash: options.artifactHash })),
      getArtifactStepResult: async ({ stepId, artifactHash }) => {
        const artifactStepResult = await get(toArtifactStepResultKey({ stepId, artifactHash }), r => {
          if (typeof r !== 'string') {
            throw new Error(
              `(2) cache.get returned a data with an invalid type. expected string, actual: "${typeof r}". data: "${r}"`,
            )
          }

          const [error, parsedResult] = validate(
            JSON.parse(r),
            object({
              executionStatus: enums([ExecutionStatus.done, ExecutionStatus.aborted]),
              status: enums(Object.values(Status)),
              durationMs: number(),
              notes: array(string()),
              errors: array(
                type({
                  name: optional(string()),
                  stack: optional(string()),
                  message: optional(string()),
                  code: optional(string()),
                }),
              ),
            }),
          )
          if (parsedResult) {
            return parsedResult
          } else {
            throw new Error(
              `(3) cache.get returned a data with an invalid schema. validation-error: "${error}". data: "${r}"`,
            )
          }
        })
        if (!artifactStepResult) {
          return undefined
        }

        return {
          flowId: artifactStepResult.flowId,
          artifactStepResult: artifactStepResult.value as
            | DoneResult
            | AbortResult<Status.skippedAsFailed | Status.skippedAsPassed>,
        }
      },
      setArtifactStepResult: async ({ artifactHash, stepId, artifactStepResult }) => {
        await set({
          key: toArtifactStepResultKey({
            stepId,
            artifactHash,
          }),
          value: JSON.stringify(artifactStepResult),
          ttl: cacheConfigurations.ttls.stepResult,
          onlySaveInNodeCache: false,
          allowOverride: false,
        })
      },
    }

    const cleanup = async () => {
      await redisClient.quit()
      await nodeCache.close()
    }

    return {
      step,
      nodeCache,
      redisClient,
      get,
      has,
      set: options =>
        set({
          key: options.key,
          value: options.value,
          ttl: options.ttl,
          onlySaveInNodeCache: false,
          allowOverride: options.allowOverride,
        }),
      cleanup,
      ttls: cacheConfigurations.ttls,
    }
  },
})
