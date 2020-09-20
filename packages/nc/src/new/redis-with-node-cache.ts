import Redis, { ValueType } from 'ioredis'
import NodeCache from 'node-cache'
import { enums, literal, object, string, union, validate, any } from 'superstruct'
import { ServerInfo } from '../types'
import { Cache, createCache } from './create-cache'
import { StepStatus } from './create-step'
import redisUrlParse from 'redis-url-parse'

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

    async function set(key: string, value: ValueType, ttl: number): Promise<void> {
      nodeCache.set(key, {
        flowId,
        value,
      })
      await redisClient.set(
        key,
        JSON.stringify({
          flowId,
          value,
        }),
        'px',
        ttl,
      )
    }

    const getResultSchema = object({
      flowId: string(),
      value: any(),
    })

    async function get<T>(
      key: string,
      mapper: (result: unknown) => T,
    ): Promise<{ flowId: string; value: T } | undefined> {
      const fromNodeCache = nodeCache.get<{ flowId: string; value: T }>(key)
      if (fromNodeCache !== null && fromNodeCache !== undefined) {
        return {
          flowId: fromNodeCache.flowId,
          value: mapper(fromNodeCache.value),
        }
      } else {
        const fromRedis = await redisClient.get(key)
        if (fromRedis === null) {
          return undefined
        } else {
          const [error, parsedResult] = validate(JSON.parse(fromRedis), getResultSchema)
          if (parsedResult) {
            const mappedValue = mapper(parsedResult.value)
            nodeCache.set(key, {
              flowId: parsedResult.flowId,
              value: mappedValue,
            })
            return {
              flowId: parsedResult.flowId,
              value: mappedValue,
            }
          } else {
            throw new Error(
              `(1) cache.get returned a data with an invalid schema. validation-error: "${error}". data: "${fromRedis}"`,
            )
          }
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
        set(
          toStepKey({ stepId: options.stepId, packageHash: options.packageHash }),
          JSON.stringify(
            {
              didStepRun: true,
              StepStatus: options.stepStatus,
            },
            null,
            2,
          ),
          options.ttlMs,
        ),
    }

    const cleanup = () => Promise.all([redisClient.quit(), nodeCache.close()])

    return {
      step,
      nodeCache,
      redisClient,
      get,
      has,
      set,
      cleanup,
      ttls: cacheConfigurations.ttls,
    }
  },
})
