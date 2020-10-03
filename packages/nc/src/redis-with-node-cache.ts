import crypto from 'crypto'
import Redis, { ValueType } from 'ioredis'
import NodeCache from 'node-cache'
import redisUrlParse from 'redis-url-parse'
import { any, object, string, validate } from 'superstruct'
import { promisify } from 'util'
import zlib from 'zlib'
import { Cache, createCache } from './create-cache'
import { StepResultOfArtifacts } from './create-step'

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
        const setOptions = ['px'] // ttl in milliseconds
        if (!options.allowOverride) {
          setOptions.push('nx') // set if not exists
        }
        await redisClient.set(options.key, zippedBuffer, setOptions, options.ttl)
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

    function toStepKey({ artifactHash, stepId }: { stepId: string; artifactHash: string }) {
      return `${stepId}-${artifactHash}`
    }

    const step: Cache['step'] = {
      didStepRun: options => has(toStepKey({ stepId: options.stepId, artifactHash: options.artifactHash })),
      getStepResult: async options => {
        const stepResultOfArtifactsKeyResult = await get(
          toStepKey({ stepId: options.stepId, artifactHash: options.artifactHash }),
          r => {
            if (typeof r !== 'string') {
              throw new Error(
                `(2) cache.get returned a data with an invalid type. expected string, actual: "${typeof r}". data: "${r}"`,
              )
            }
            const [error, parsedResult] = validate(JSON.parse(r), string())
            if (parsedResult) {
              return parsedResult
            } else {
              throw new Error(
                `(3) cache.get returned a data with an invalid schema. validation-error: "${error}". data: "${r}"`,
              )
            }
          },
        )
        if (!stepResultOfArtifactsKeyResult) {
          return undefined
        }

        const stepResultOfArtifactsResult = await get(stepResultOfArtifactsKeyResult.value, r => {
          if (typeof r !== 'string') {
            throw new Error(
              `(4) cache.get returned a data with an invalid type. expected string, actual: "${typeof r}". data: "${r}"`,
            )
          }
          return JSON.parse(r) as StepResultOfArtifacts
        })
        if (!stepResultOfArtifactsResult) {
          return undefined
        }
        return {
          flowId: stepResultOfArtifactsResult.flowId,
          stepResultOfArtifacts: stepResultOfArtifactsResult.value,
        }
      },
      setStepResult: async stepResultOfArtifacts => {
        const asString = JSON.stringify(stepResultOfArtifacts, null, 2)
        const hasher = crypto.createHash('sha224')
        hasher.update(asString)
        const stepResultOfArtifactsKey = `step-result-of-artifacts---${
          stepResultOfArtifacts.stepInfo.stepId
        }-${Buffer.from(hasher.digest()).toString('hex')}`

        await Promise.all([
          await set({
            key: stepResultOfArtifactsKey,
            value: asString,
            ttl: cacheConfigurations.ttls.stepResult,
            onlySaveInNodeCache: false,
            allowOverride: false,
          }),
          ...artifacts.map(a =>
            set({
              key: toStepKey({
                stepId: stepResultOfArtifacts.stepInfo.stepId,
                artifactHash: a.data.artifact.packageHash,
              }),
              value: stepResultOfArtifactsKey,
              ttl: cacheConfigurations.ttls.stepResult,
              onlySaveInNodeCache: false,
              allowOverride: false,
            }),
          ),
        ])
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
