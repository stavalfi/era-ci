import Redis from 'ioredis'
import { promisify } from 'util'
import zlib from 'zlib'
import { createKeyValueStoreConnection } from './create-key-value-store-connection'

export type RedisConfiguration = {
  redisServerUri: string
}

async function zip(data: string): Promise<Buffer> {
  return promisify<string, Buffer>(zlib.deflate)(data)
}

async function unzip(buffer: Buffer): Promise<string> {
  const result = await promisify<Buffer, Buffer>(zlib.unzip)(buffer)
  return result.toString()
}

export const redisConnection = createKeyValueStoreConnection<RedisConfiguration>({
  initializeCreateKeyValueStoreConnection: async ({ keyValueStoreConnectionConfigurations }) => {
    const redisClient = new Redis(keyValueStoreConnectionConfigurations.redisServerUri)
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
