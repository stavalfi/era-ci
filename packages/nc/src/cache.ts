import { logger } from '@tahini/log'
import Redis from 'ioredis'
import semver from 'semver'
import { isDockerVersionAlreadyPulished } from './docker-utils'
import { isNpmVersionAlreadyPulished } from './npm-utils'
import { Auth, Cache, CacheTypes, PackageVersion, ServerInfo, TargetType } from './types'
import NodeCache from 'node-cache'

const log = logger('cache')

const REDIS_TTL = 1000 * 60 * 24 * 30

const toPublishKey = (packageName: string, targetType: TargetType, packageHash: string) =>
  `${CacheTypes.publish}-${packageName}-${targetType}-${packageHash}`

const toTestKey = (packageName: string, packageHash: string) => `${CacheTypes.publish}-${packageName}-${packageHash}`

type Get = (key: string) => Promise<string | null>
type Has = (key: string) => Promise<boolean>
type Set = (key: string, value: string | number) => Promise<void>

const isPublished = ({
  npmRegistry,
  get,
  dockerOrganizationName,
  dockerRegistry,
  targetType,
}: {
  get: Get
  npmRegistry: ServerInfo
  dockerRegistry: ServerInfo
  dockerOrganizationName: string
  targetType: TargetType
}) => async (packageName: string, packageHash: string): Promise<PackageVersion | false> => {
  async function checkInCache() {
    const result = await get(toPublishKey(packageName, targetType, packageHash))
    if (!result) {
      return false
    } else {
      if (semver.valid(result)) {
        return result
      } else {
        log.verbose(
          `hash of package ${packageName} was found but it points to an invalid verison: ${result}. ignoring this record`,
        )
        return false
      }
    }
  }

  const inCache = await checkInCache()

  if (!inCache) {
    return false
  }

  switch (targetType) {
    case TargetType.npm: {
      const inRegistry = await isNpmVersionAlreadyPulished({ packageName, packageVersion: inCache, npmRegistry })
      return inRegistry ? inCache : false
    }
    case TargetType.docker: {
      const inRegistry = await isDockerVersionAlreadyPulished({
        dockerOrganizationName,
        dockerRegistry,
        imageTag: inCache,
        packageName,
      })
      return inRegistry ? inCache : false
    }
  }
}

const setAsPublished = ({ set, targetType }: { set: Set; targetType: TargetType }) => async (
  packageName: string,
  packageHash: string,
  packageVersion: string,
): Promise<void> => {
  await set(toPublishKey(packageName, targetType, packageHash), packageVersion)
}

enum TestsResult {
  passed = 'passed',
  failed = 'failed',
}

const isTestsRun = (has: Has) => async (packageName: string, packageHash: string) =>
  has(toTestKey(packageName, packageHash))

const isPassed = (get: Get) => async (packageName: string, packageHash: string) =>
  Boolean((await get(toTestKey(packageName, packageHash))) === TestsResult.passed)

const setResult = (set: Set) => (packageName: string, packageHash: string, isPassed: boolean) =>
  set(toTestKey(packageName, packageHash), isPassed ? TestsResult.passed : TestsResult.failed)

export async function intializeCache({
  auth,
  redisServer,
  dockerOrganizationName,
  dockerRegistry,
  npmRegistry,
}: {
  redisServer: ServerInfo
  auth: Pick<Auth, 'redisPassword'>
  npmRegistry: ServerInfo
  dockerRegistry: ServerInfo
  dockerOrganizationName: string
}): Promise<Cache> {
  const nodeCache = new NodeCache()

  const redisClient = new Redis({
    host: redisServer.host,
    port: redisServer.port,
    ...(auth.redisPassword && { password: auth.redisPassword }),
  })

  async function set(key: string, value: string | number): Promise<void> {
    nodeCache.set(key, value)
    await redisClient.set(key, value, 'px', REDIS_TTL)
  }

  async function get(key: string): Promise<string | null> {
    const fromNodeCatch = nodeCache.get(key) as string
    if (fromNodeCatch) {
      await set(key, fromNodeCatch) // we try to avoid situation where the key is in nodeCache but not in redis
      return fromNodeCatch
    } else {
      const fromRedis = await redisClient.get(key)
      if (fromRedis !== null) {
        nodeCache.set(key, fromRedis)
      }
      return fromRedis
    }
  }

  async function has(key: string): Promise<boolean> {
    const fromNodeCatch = nodeCache.has(key)
    if (fromNodeCatch) {
      await set(key, nodeCache.get(key) as string) // we try to avoid situation where the key is in nodeCache but not in redis
      return true
    } else {
      const fromRedis = await redisClient.get(key)
      if (fromRedis !== null) {
        nodeCache.set(key, fromRedis)
        return true
      }
      return false
    }
  }

  return {
    test: {
      isTestsRun: isTestsRun(has),
      isPassed: isPassed(get),
      setResult: setResult(set),
    },
    publish: {
      npm: {
        isPublished: isPublished({
          dockerOrganizationName,
          dockerRegistry,
          get,
          npmRegistry,
          targetType: TargetType.npm,
        }),
        setAsPublished: setAsPublished({
          set,
          targetType: TargetType.npm,
        }),
      },
      docker: {
        isPublished: isPublished({
          dockerOrganizationName,
          dockerRegistry,
          get,
          npmRegistry,
          targetType: TargetType.docker,
        }),
        setAsPublished: setAsPublished({
          set,
          targetType: TargetType.docker,
        }),
      },
    },
    cleanup: () => Promise.all([redisClient.quit(), nodeCache.close()]),
  }
}
