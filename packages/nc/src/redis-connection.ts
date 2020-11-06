import Redis from 'ioredis'
import redisUrlParse from 'redis-url-parse'
import { promisify } from 'util'
import zlib from 'zlib'
import { createKeyValueStoreConnection } from './create-key-value-store-connection'

export type RedisConfiguration = {
  redisServer: string
  auth?: {
    password?: string
  }
}

type NormalizedRedisConfiguration = {
  redisServer: {
    host: string
    port: number
  }
  auth?: {
    password?: string
  }
}

async function zip(data: string): Promise<Buffer> {
  return promisify<string, Buffer>(zlib.deflate)(data)
}

async function unzip(buffer: Buffer): Promise<string> {
  const result = await promisify<Buffer, Buffer>(zlib.unzip)(buffer)
  return result.toString()
}

export const redisConnection = createKeyValueStoreConnection<RedisConfiguration, NormalizedRedisConfiguration>({
  normalizedKeyValueStoreConnectionConfigurations: async ({ redisServer, auth }) => {
    const parsedRedisServer = redisUrlParse(redisServer)
    return {
      auth,
      redisServer: {
        host: parsedRedisServer.host,
        port: parsedRedisServer.port,
      },
    }
  },
  initializeCreateKeyValueStoreConnection: async ({ keyValueStoreConnectionConfigurations }) => {
    const redisClient = new Redis({
      host: keyValueStoreConnectionConfigurations.redisServer.host,
      port: keyValueStoreConnectionConfigurations.redisServer.port,
      password: keyValueStoreConnectionConfigurations.auth?.password,
    })

    async function set(options: { key: string; value: string; allowOverride: boolean; ttl: number }): Promise<void> {
      const zippedBuffer = await zip(options.value)
      await redisClient.set(options.key, zippedBuffer, 'px', options.ttl, options.allowOverride ? undefined : 'nx')
    }

    async function get<T>(key: string, mapper: (result: string) => T): Promise<T | undefined> {
      const fromRedis = await redisClient.getBuffer(key)
      if (fromRedis === null || fromRedis === undefined) {
        return undefined
      }
      const unzipped = await unzip(fromRedis)
      return mapper(unzipped)
    }

    async function has(key: string): Promise<boolean> {
      return redisClient.exists(key).then(result => result === 1)
    }

    const cleanup = async () => {
      await redisClient.quit()
    }

    return {
      redisClient,
      get,
      has,
      set,
      cleanup,
    }
  },
})
