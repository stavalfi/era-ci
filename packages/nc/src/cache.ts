import Redis from 'ioredis'
import NodeCache from 'node-cache'
import semver from 'semver'
import { isDockerVersionAlreadyPulished } from './docker-utils'
import { isNpmVersionAlreadyPulished } from './npm-utils'
import {
  Cache,
  CacheTypes,
  CiOptions,
  FlowId,
  IsPublishResultCache,
  JsonReport,
  PackageVersion,
  TargetsInfo,
  TargetType,
} from './types'

const DEFAULT_TTL = 1000 * 60 * 24 * 30
const FLOW_LOGS_COINTENT_TTL = 1000 * 60 * 24 * 7

const toDeploymentKey = (packageName: string, targetType: TargetType, packageHash: string) =>
  `${CacheTypes.deployment}-${packageName}-${targetType}-${packageHash}`

const toPublishKey = (packageName: string, targetType: TargetType, packageHash: string) =>
  `${CacheTypes.publish}-${packageName}-${targetType}-${packageHash}`

const toTestKey = (packageName: string, packageHash: string) => `${CacheTypes.test}-${packageName}-${packageHash}`

const toFlowKey = (flowId: string) => `${CacheTypes.flow}-${flowId}`

const toFlowLogsContentKey = (flowId: string) => `${CacheTypes.flow}-${flowId}`

type Get = (key: string, ttl: number) => Promise<string | null>
type Has = (key: string, ttl: number) => Promise<FlowId | undefined>
type Set = (key: string, value: string, ttl: number) => Promise<void>

enum DeploymentResult {
  passed = 'passed',
  failed = 'failed',
}

const isDeploymentRun = (targetType: TargetType, has: Has) => async (
  packageName: string,
  packageHash: string,
): Promise<FlowId | undefined> => {
  return has(toDeploymentKey(packageName, targetType, packageHash), DEFAULT_TTL)
}

const isDeployed = (targetType: TargetType, get: Get) => async (
  packageName: string,
  packageHash: string,
): Promise<boolean> => {
  return (await get(toDeploymentKey(packageName, targetType, packageHash), DEFAULT_TTL)) === DeploymentResult.passed
}

const setDeploymentResult = (targetType: TargetType, set: Set) => async (
  packageName: string,
  packageHash: string,
  isDeployed: boolean,
): Promise<void> => {
  await set(
    toDeploymentKey(packageName, targetType, packageHash),
    isDeployed ? DeploymentResult.passed : DeploymentResult.failed,
    DEFAULT_TTL,
  )
}

const isPublishRun = (targetType: TargetType, has: Has) => async (
  packageName: string,
  packageHash: string,
): Promise<FlowId | undefined> => {
  return has(toPublishKey(packageName, targetType, packageHash), DEFAULT_TTL)
}

const setAsFailed = (targetType: TargetType, set: Set) => async (
  packageName: string,
  packageHash: string,
): Promise<void> => {
  return set(
    toPublishKey(packageName, targetType, packageHash),
    '' /* falsy value to indicate that we failed to publish */,
    DEFAULT_TTL,
  )
}

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
}): Promise<null | false | PackageVersion> {
  const result = await get(toPublishKey(packageName, targetType, packageHash), DEFAULT_TTL)
  if (result === null) {
    return null
  }

  if (!result) {
    return false
  }

  if (semver.valid(result)) {
    return result
  } else {
    throw new Error(
      `it looks like an internal bug of the CI - hash of package ${packageName} was found in redis but it points to an invalid verison: ${result}`,
    )
  }
}

const isPackagePublished = ({
  get,
  has,
  isInRegistry,
  targetType,
}: {
  get: Get
  has: Has
  isInRegistry: (packageName: string, packageVersion: string) => Promise<boolean>
  targetType: TargetType
}) => async (packageName: string, packageHash: string): Promise<IsPublishResultCache> => {
  let inCache: null | false | PackageVersion
  try {
    inCache = await checkIfPublishedInCache({ get, packageHash, packageName, targetType })
  } catch (error) {
    return {
      shouldPublish: true,
      publishSucceed: false,
      failureReason: error,
    }
  }

  if (inCache === null) {
    return {
      shouldPublish: true,
    }
  }

  if (!inCache) {
    const flowId = await has(toPublishKey(packageName, targetType, packageHash), DEFAULT_TTL)
    if (!flowId) {
      throw new Error(`looks like a bug. redis.get returned a value but redis.has didn't`)
    }
    return {
      shouldPublish: false,
      publishSucceed: false,
      failureReason: `nothing changed and publish already failed in flow: "${flowId}"`,
    }
  }

  const packageVersion = inCache

  const inRegistry = await isInRegistry(packageName, packageVersion)
  if (inRegistry) {
    return {
      shouldPublish: false,
      publishSucceed: true,
      alreadyPublishedAsVersion: inCache,
    }
  } else {
    // it's a valid scenario: cache say that the package was published but it's not in the registry.
    // maybe someone unpublished the package from the registry after the pacvkage was published.
    // i don't want to mutate the cache because the cache is read-only to avoid synchronization
    // between multiple instances of the CI which try to run on the same package with the same hash.
    // so there is a small panalty of asking the registry over and over again but remmember - it's just
    // for this specific hash so it doesn't really heart anyone.
    return {
      shouldPublish: true,
    }
  }
}

const setAsPublished = ({ set, targetType }: { set: Set; targetType: TargetType }) => async (
  packageName: string,
  packageHash: string,
  packageVersion: string,
): Promise<void> => {
  await set(toPublishKey(packageName, targetType, packageHash), packageVersion, DEFAULT_TTL)
}

enum TestsResult {
  passed = 'passed',
  failed = 'failed',
}

const setFlowResult = (flowId: string, set: Set) => async (jsonReport: JsonReport): Promise<void> => {
  await set(toFlowKey(flowId), JSON.stringify(jsonReport, null, 2), FLOW_LOGS_COINTENT_TTL)
}

const isTestsRun = (has: Has) => async (packageName: string, packageHash: string) =>
  has(toTestKey(packageName, packageHash), DEFAULT_TTL)

const isPassed = (get: Get) => async (packageName: string, packageHash: string) =>
  Boolean((await get(toTestKey(packageName, packageHash), DEFAULT_TTL)) === TestsResult.passed)

const setResult = (set: Set) => (packageName: string, packageHash: string, isPassed: boolean) =>
  set(toTestKey(packageName, packageHash), isPassed ? TestsResult.passed : TestsResult.failed, DEFAULT_TTL)

type IntializeCacheOptions<DeploymentClient> = {
  flowId: string
  redis: CiOptions<DeploymentClient>['redis']
  targetsInfo?: TargetsInfo<DeploymentClient>
  repoPath: string
}

export async function intializeCache<DeploymentClient>({
  flowId,
  redis,
  targetsInfo,
  repoPath,
}: IntializeCacheOptions<DeploymentClient>): Promise<Cache> {
  const nodeCache = new NodeCache()

  const redisClient = new Redis({
    host: redis.redisServer.host,
    port: redis.redisServer.port,
    ...(redis.auth.password && { password: redis.auth.password }),
  })

  type RedisSchema = { flowId: string; value: string }

  const toRedisSchema = (value: string): RedisSchema => JSON.parse(value)

  async function setBase(key: string, value: string, ttl: number): Promise<void> {
    nodeCache.set(key, value)
    await redisClient.set(key, value, 'px', ttl)
  }

  async function set(key: string, value: string, ttl: number): Promise<void> {
    const asSchema: RedisSchema = { flowId, value }
    await setBase(key, JSON.stringify(asSchema, null, 2), ttl)
  }

  async function get(key: string, ttl: number): Promise<string | null> {
    const fromNodeCache = nodeCache.get<string>(key)
    if (fromNodeCache) {
      await setBase(key, fromNodeCache, ttl) // we try to avoid situation where the key is in nodeCache but not in redis
      return toRedisSchema(fromNodeCache).value
    } else {
      const fromRedis = await redisClient.get(key)
      if (fromRedis === null) {
        return null
      } else {
        nodeCache.set(key, fromRedis)
        return toRedisSchema(fromRedis).value
      }
    }
  }

  async function has(key: string, ttl: number): Promise<FlowId | undefined> {
    const fromNodeCache = nodeCache.get<string>(key)
    if (fromNodeCache) {
      await set(key, nodeCache.get(key) as string, ttl) // we try to avoid situation where the key is in nodeCache but not in redis
      return toRedisSchema(fromNodeCache).flowId
    } else {
      const fromRedis = await redisClient.get(key)
      if (fromRedis === null) {
        return undefined
      } else {
        nodeCache.set(key, fromRedis)
        return toRedisSchema(fromRedis).flowId
      }
    }
  }

  let npm: Cache['publish'][TargetType.npm] | undefined
  if (targetsInfo?.npm) {
    const { registry } = targetsInfo.npm
    npm = {
      isPublishRun: isPublishRun(TargetType.npm, has),
      setAsFailed: setAsFailed(TargetType.npm, set),
      isPublished: isPackagePublished({
        has,
        get,
        targetType: TargetType.npm,
        isInRegistry: (packageName, packageVersion) =>
          isNpmVersionAlreadyPulished({ packageName, packageVersion, npmRegistry: registry, repoPath }),
      }),
      setAsPublished: setAsPublished({
        set,
        targetType: TargetType.npm,
      }),
    }
  }

  let docker: Cache['publish'][TargetType.docker] | undefined
  if (targetsInfo?.docker) {
    const targetInfo = targetsInfo.docker
    docker = {
      isPublishRun: isPublishRun(TargetType.docker, has),
      setAsFailed: setAsFailed(TargetType.docker, set),
      isPublished: isPackagePublished({
        has,
        get,
        targetType: TargetType.docker,
        isInRegistry: (packageName, packageVersion) =>
          isDockerVersionAlreadyPulished({
            dockerOrganizationName: targetInfo.dockerOrganizationName,
            dockerRegistry: targetInfo.registry,
            imageTag: packageVersion,
            packageName,
            publishAuth: targetInfo.publishAuth,
            repoPath,
          }),
      }),
      setAsPublished: setAsPublished({ set, targetType: TargetType.docker }),
    }
  }

  const publish: Cache['publish'] = {
    ...(npm && {
      npm,
    }),
    ...(docker && {
      docker,
    }),
  }

  const deployment: Cache['deployment'] = {
    ...(targetsInfo?.npm && {
      npm: {
        isDeploymentRun: isDeploymentRun(TargetType.npm, has),
        isDeployed: isDeployed(TargetType.npm, get),
        setDeploymentResult: setDeploymentResult(TargetType.npm, set),
      },
    }),
    ...(targetsInfo?.docker && {
      docker: {
        isDeploymentRun: isDeploymentRun(TargetType.docker, has),
        isDeployed: isDeployed(TargetType.docker, get),
        setDeploymentResult: setDeploymentResult(TargetType.docker, set),
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
    deployment,
    flow: {
      setFlowResult: setFlowResult(flowId, set),
      saveFlowLogsContent: (flowId, ncLogsContent) =>
        set(toFlowLogsContentKey(flowId), ncLogsContent, FLOW_LOGS_COINTENT_TTL),
      readFlowLogsContent: flowId => get(toFlowLogsContentKey(flowId), FLOW_LOGS_COINTENT_TTL),
    },
    cleanup: () => Promise.all([redisClient.quit(), nodeCache.close()]),
  }
}
