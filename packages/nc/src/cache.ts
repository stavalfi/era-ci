/* eslint-disable no-console */
import { logger } from '@tahini/log'
import Redis from 'ioredis'
import NodeCache from 'node-cache'
import semver from 'semver'
import { isDockerVersionAlreadyPulished } from './docker-utils'
import { isNpmVersionAlreadyPulished } from './npm-utils'
import {
  Cache,
  CacheTypes,
  PackageVersion,
  ServerInfo,
  TargetsInfo,
  TargetType,
  CiOptions,
  TargetsPublishAuth,
} from './types'

const log = logger('cache')

const REDIS_TTL = 1000 * 60 * 24 * 30

const toPublishKey = (packageName: string, targetType: TargetType, packageHash: string) =>
  `${CacheTypes.publish}-${packageName}-${targetType}-${packageHash}`

const toTestKey = (packageName: string, packageHash: string) => `${CacheTypes.publish}-${packageName}-${packageHash}`

type Get = (key: string) => Promise<string | null>
type Has = (key: string) => Promise<boolean>
type Set = (key: string, value: string | number) => Promise<void>

async function checkIfPublishedInCache({
  get,
  packageHash,
  packageName,
  targetType,
}: {
  get: Get
  packageName: string
  packageHash: string
  targetType: TargetType
}) {
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

const isNpmPublished = ({ npmRegistry, get }: { get: Get; npmRegistry: ServerInfo }) => async (
  packageName: string,
  packageHash: string,
): Promise<PackageVersion | false> => {
  const inCache = await checkIfPublishedInCache({ get, packageHash, packageName, targetType: TargetType.npm })

  if (!inCache) {
    return false
  }

  const inRegistry = await isNpmVersionAlreadyPulished({ packageName, packageVersion: inCache, npmRegistry })
  return inRegistry ? inCache : false
}

const isDockerPublished = ({
  get,
  dockerOrganizationName,
  dockerRegistry,
  publishAuth,
}: {
  get: Get
  dockerRegistry: ServerInfo
  dockerOrganizationName: string
  publishAuth: TargetsPublishAuth[TargetType.docker]
}) => async (packageName: string, packageHash: string): Promise<PackageVersion | false> => {
  const inCache = await checkIfPublishedInCache({ get, packageHash, packageName, targetType: TargetType.docker })

  if (!inCache) {
    return false
  }

  const inRegistry = await isDockerVersionAlreadyPulished({
    dockerOrganizationName,
    dockerRegistry,
    imageTag: inCache,
    packageName,
    publishAuth,
  })
  return inRegistry ? inCache : false
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

type IntializeCacheOptions<DeploymentClient> = {
  redis: CiOptions<DeploymentClient>['redis']
  targetsInfo?: TargetsInfo<DeploymentClient>
}

export async function intializeCache<DeploymentClient>({
  redis,
  targetsInfo,
}: IntializeCacheOptions<DeploymentClient>): Promise<Cache> {
  const nodeCache = new NodeCache()

  const redisClient = new Redis({
    host: redis.redisServer.host,
    port: redis.redisServer.port,
    ...(redis.auth.password && { password: redis.auth.password }),
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

  const publish: Cache['publish'] = {
    ...(targetsInfo?.npm && {
      npm: {
        isPublished: isNpmPublished({
          get,
          npmRegistry: targetsInfo.npm.registry,
        }),
        setAsPublished: setAsPublished({
          set,
          targetType: TargetType.npm,
        }),
      },
    }),
    ...(targetsInfo?.docker && {
      docker: {
        isPublished: isDockerPublished({
          get,
          dockerRegistry: targetsInfo.docker.registry,
          dockerOrganizationName: targetsInfo.docker.dockerOrganizationName,
          publishAuth: targetsInfo.docker.publishAuth,
        }),
        setAsPublished: setAsPublished({
          set,
          targetType: TargetType.docker,
        }),
      },
    }),
  }

  return {
    test: {
      isTestsRun: isTestsRun(has),
      isPassed: isPassed(get),
      setResult: setResult(set),
    },
    publish,
    cleanup: () => Promise.all([redisClient.quit(), nodeCache.close()]),
  }
}
