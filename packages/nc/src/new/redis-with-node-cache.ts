import Redis, { ValueType } from 'ioredis'
import NodeCache from 'node-cache'
import { enums, literal, object, string, union, validate } from 'superstruct'
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
      nodeCache.set(key, value)
      await redisClient.set(key, value, 'px', ttl)
    }

    async function get<T>(key: string, mapper: (result: unknown) => T): Promise<T | undefined> {
      const fromNodeCache = nodeCache.get<string>(key)
      if (fromNodeCache !== null && fromNodeCache !== undefined) {
        return mapper(fromNodeCache)
      } else {
        const fromRedis = await redisClient.get(key)
        if (fromRedis === null) {
          return undefined
        } else {
          nodeCache.set(key, fromRedis)
          return mapper(fromRedis)
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
        flowId: string(),
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
      getStepResult: options =>
        get(toStepKey({ stepId: options.stepId, packageHash: options.packageHash }), r => {
          if (typeof r !== 'string') {
            throw new Error(
              `cache.get returned a data with an invalid type. expected string, actual: "${typeof r}". data: "${r}"`,
            )
          }
          const [error, parsedResult] = validate(JSON.parse(r), getStepResultSchema)
          if (parsedResult) {
            return parsedResult
          } else {
            throw new Error(
              `cache.get returned a data with an invalid schema. validation-error: "${error}". data: "${r}"`,
            )
          }
        }),
      setStepResult: options =>
        set(
          toStepKey({ stepId: options.stepId, packageHash: options.packageHash }),
          JSON.stringify(
            {
              didStepRun: true,
              StepStatus: options.stepStatus,
              flowId,
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
