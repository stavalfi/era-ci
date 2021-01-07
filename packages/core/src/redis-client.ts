import Redis from 'ioredis'
import zlib from 'zlib'
import { promisify } from 'util'

export type RedisConfiguration = {
  url: string
  auth?: {
    username?: string
    password?: string
  }
}

export type RedisClient = {
  connection: Redis.Redis
  get: <T>(key: string, mapper: (result: unknown) => T) => Promise<T | undefined>
  set: (options: { key: string; value: string; allowOverride: boolean; ttl: number }) => Promise<void>
  has: (key: string) => Promise<boolean>
  cleanup: () => Promise<unknown>
}

async function zip(data: string): Promise<Buffer> {
  return promisify<string, Buffer>(zlib.deflate)(data)
}

async function unzip(buffer: Buffer): Promise<string> {
  const result = await promisify<Buffer, Buffer>(zlib.unzip)(buffer)
  return result.toString()
}

export const connectToRedis = async (config: RedisConfiguration): Promise<RedisClient> => {
  const connection = new Redis(config.url, {
    username: config.auth?.username,
    password: config.auth?.password,
  })
  async function set(options: { key: string; value: string; allowOverride: boolean; ttl: number }): Promise<void> {
    const zippedBuffer = await zip(options.value)
    await connection.set(options.key, zippedBuffer, 'px', options.ttl, options.allowOverride ? undefined : 'nx')
  }

  async function get<T>(key: string, mapper: (result: string) => T): Promise<T | undefined> {
    const fromRedis = await connection.getBuffer(key)
    if (fromRedis === null || fromRedis === undefined) {
      return undefined
    }
    const unzipped = await unzip(fromRedis)
    return mapper(unzipped)
  }

  async function has(key: string): Promise<boolean> {
    return connection.exists(key).then(result => result === 1)
  }

  const cleanup = async () => {
    await connection.quit()
  }

  return {
    connection,
    get,
    has,
    set,
    cleanup,
  }
}
