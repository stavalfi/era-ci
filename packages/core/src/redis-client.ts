import Redis from 'ioredis'
import zlib from 'zlib'
import { promisify } from 'util'
import { Logger } from './create-logger'

export type RedisConfiguration = {
  url: string
  auth?: {
    username?: string
    password?: string
  }
}

export type RedisClient = {
  connection: Redis.Redis
  get: <T>(options: { key: string; isBuffer: boolean; mapper: (result: unknown) => T }) => Promise<T | undefined>
  set: (options: {
    key: string
    value: string
    asBuffer: boolean
    allowOverride: boolean
    ttl: number
  }) => Promise<void>
  has: (key: string) => Promise<boolean>
  multi: (commands: string[][]) => Promise<unknown[]>
  cleanup: () => Promise<unknown>
}

async function zip(data: string): Promise<Buffer> {
  return promisify<string, Buffer>(zlib.deflate)(data)
}

async function unzip(buffer: Buffer): Promise<string> {
  const result = await promisify<Buffer, Buffer>(zlib.unzip)(buffer)
  return result.toString()
}

export const connectToRedis = async ({
  config,
  logger,
}: {
  config: RedisConfiguration
  logger: Logger
}): Promise<RedisClient> => {
  const log = logger.createLog('redis-client')

  const connection = new Redis(config.url, {
    username: config.auth?.username,
    password: config.auth?.password,
  })

  async function set({
    key,
    value,
    asBuffer,
    allowOverride,
    ttl,
  }: {
    key: string
    value: string
    asBuffer: boolean
    allowOverride: boolean
    ttl: number
  }): Promise<void> {
    await connection.set(key, asBuffer ? await zip(value) : value, 'px', ttl, allowOverride ? undefined : 'nx')
  }

  async function get<T>({
    key,
    isBuffer,
    mapper,
  }: {
    key: string
    isBuffer: boolean
    mapper: (result: string) => T
  }): Promise<T | undefined> {
    if (isBuffer) {
      const fromRedis = await connection.getBuffer(key)
      if (fromRedis === null || fromRedis === undefined) {
        return undefined
      }
      const unzipped = await unzip(fromRedis)
      return mapper(unzipped)
    } else {
      const fromRedis = await connection.get(key)
      if (fromRedis === null || fromRedis === undefined) {
        return undefined
      }
      return mapper(fromRedis)
    }
  }

  async function has(key: string): Promise<boolean> {
    return connection.exists(key).then(result => result === 1)
  }

  async function multi(commands: string[][]): Promise<unknown[]> {
    const results: Array<[Error | null, unknown]> = await connection.multi(commands).exec()

    if (results.some(([error]) => error)) {
      throw results
    }

    return results.map(([_error, result]) => result)
  }

  const cleanup = async () => {
    connection.disconnect()
    log.debug(`closed redis-client to redis`)
  }

  return {
    connection,
    get,
    has,
    set,
    multi,
    cleanup,
  }
}
