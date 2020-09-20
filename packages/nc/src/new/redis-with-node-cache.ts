import Redis, { ValueType } from 'ioredis'
import NodeCache from 'node-cache'
import { enums, literal, object, string, union, validate, any } from 'superstruct'
import { ServerInfo } from '../types'
import { Cache, createCache } from './create-cache'
import { StepStatus } from './create-step'
import redisUrlParse from 'redis-url-parse'
import { promisify } from 'util'
import zlib from 'zlib'

export type CacheConfiguration = {
  redis: {
    redisServer: string
    auth?: {
      password?: string
    }
  }
  ttls?: {
    stepResult?: number
    flowLogs?: number
  }
}

type NormalizedCacheConfiguration = {
  redis: {
    redisServer: ServerInfo
    auth?: {
      password?: string
    }
  }
  ttls: {
    stepResult: number
    flowLogs: number
  }
}

export async function zip(data: string): Promise<Buffer> {
  return promisify<string, Buffer>(zlib.deflate)(data)
}

export async function unzip(buffer: Buffer): Promise<string> {
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
        stepResult: ttls?.stepResult ?? 1000 * 60 * 60 * 24 * 7, // default-ttl = 1-week
        flowLogs: ttls?.stepResult ?? 1000 * 60 * 60 * 24 * 3, // default-ttl = 3-days
      },
    }
  },
  initializeCache: async ({ cacheConfigurations, flowId }) => {
    const nodeCache = new NodeCache()

    const redisClient = new Redis({
      host: cacheConfigurations.redis.redisServer.host,
      port: cacheConfigurations.redis.redisServer.port,
      password: cacheConfigurations.redis.auth?.password,
    })

    async function set(
      options:
        | {
            key: string
            value: ValueType
            onlySaveInNodeCache: true
          }
        | { key: string; value: ValueType; ttl: number; onlySaveInNodeCache: false },
    ): Promise<void> {
      const zippedBuffer = await zip(
        JSON.stringify({
          flowId,
          value: options.value,
        }),
      )
      nodeCache.set(options.key, {
        flowId,
        zippedBuffer,
      })
      if (!options.onlySaveInNodeCache) {
        await redisClient.set(options.key, zippedBuffer, 'px', options.ttl)
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
        const result = await transformFromCache(fromRedis, mapper)
        if (result) {
          await set({
            key,
            value: JSON.stringify(result),
            onlySaveInNodeCache: true,
          })
          return result
        } else {
          return undefined
        }
      }
    }

    async function has(key: string): Promise<boolean> {
      return nodeCache.has(key) || (await redisClient.exists(key).then(result => result === 1))
    }

    const getStepResultSchema = union([
      object({
        didStepRun: literal(true),
        StepStatus: enums(Object.values(StepStatus)),
      }),
      object({
        didStepRun: literal(false),
      }),
    ])

    function toStepKey({ packageHash, stepId }: { stepId: string; packageHash: string }) {
      return `${stepId}-${packageHash}`
    }

    const step: Cache['step'] = {
      didStepRun: options => has(toStepKey({ stepId: options.stepId, packageHash: options.packageHash })),
      getStepResult: async options => {
        const result = await get(toStepKey({ stepId: options.stepId, packageHash: options.packageHash }), r => {
          if (typeof r !== 'string') {
            throw new Error(
              `(2) cache.get returned a data with an invalid type. expected string, actual: "${typeof r}". data: "${r}"`,
            )
          }
          const [error, parsedResult] = validate(JSON.parse(r), getStepResultSchema)
          if (parsedResult) {
            return parsedResult
          } else {
            throw new Error(
              `(3) cache.get returned a data with an invalid schema. validation-error: "${error}". data: "${r}"`,
            )
          }
        })
        if (!result) {
          return undefined
        }
        if (result.value.didStepRun) {
          return {
            flowId: result.flowId,
            didStepRun: true,
            StepStatus: result.value.StepStatus,
          }
        } else {
          return {
            didStepRun: false,
          }
        }
      },
      setStepResult: options =>
        set({
          key: toStepKey({ stepId: options.stepId, packageHash: options.packageHash }),
          value: JSON.stringify(
            {
              didStepRun: true,
              StepStatus: options.stepStatus,
            },
            null,
            2,
          ),
          ttl: options.ttlMs,
          onlySaveInNodeCache: false,
        }),
    }

    const cleanup = () => Promise.all([redisClient.quit(), nodeCache.close()])

    return {
      step,
      nodeCache,
      redisClient,
      get,
      has,
      set: (key: string, value: ValueType, ttl: number) => set({ key, value, ttl, onlySaveInNodeCache: false }),
      cleanup,
      ttls: cacheConfigurations.ttls,
    }
  },
})
