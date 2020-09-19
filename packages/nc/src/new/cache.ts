import Redis, { ValueType } from 'ioredis'
import NodeCache from 'node-cache'
import { enums, literal, object, string, union, validate } from 'superstruct'
import { CiOptions } from '../types'
import { Cache, StepStatus } from './types'

function toStepKey({ packageHash, stepId }: { stepId: string; packageHash: string }) {
  return `${stepId}-${packageHash}`
}

export enum CacheTtl {
  stepResult = 1000 * 60 * 24 * 10,
}

export async function intializeCache({
  redis,
  flowId,
}: {
  redis: CiOptions<unknown>['redis']
  flowId: string
}): Promise<Cache> {
  const nodeCache = new NodeCache()

  const redisClient = new Redis({
    host: redis.redisServer.host,
    port: redis.redisServer.port,
    ...(redis.auth.password && { password: redis.auth.password }),
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
  }
}
