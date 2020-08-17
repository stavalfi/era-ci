import Redis from 'ioredis'
import NodeCache from 'node-cache'
import semver from 'semver'
import { isDockerVersionAlreadyPulished } from './docker-utils'
import { isNpmVersionAlreadyPulished } from './npm-utils'
import { Cache, CacheTypes, CiOptions, IsPublishResultCache, PackageVersion, TargetsInfo, TargetType } from './types'

const REDIS_TTL = 1000 * 60 * 24 * 30

const toDeploymentKey = (packageName: string, targetType: TargetType, packageHash: string) =>
  `${CacheTypes.deployment}-${packageName}-${targetType}-${packageHash}`

const toPublishKey = (packageName: string, targetType: TargetType, packageHash: string) =>
  `${CacheTypes.publish}-${packageName}-${targetType}-${packageHash}`

const toTestKey = (packageName: string, packageHash: string) => `${CacheTypes.test}-${packageName}-${packageHash}`

type Get = (key: string) => Promise<string | null>
type Has = (key: string) => Promise<boolean>
type Set = (key: string, value: string | number) => Promise<void>

enum DeploymentResult {
  passed = 'passed',
  failed = 'failed',
}

const isDeploymentRun = (targetType: TargetType, has: Has) => async (
  packageName: string,
  packageHash: string,
): Promise<boolean> => {
  return has(toDeploymentKey(packageName, targetType, packageHash))
}

const isDeployed = (targetType: TargetType, get: Get) => async (
  packageName: string,
  packageHash: string,
): Promise<boolean> => {
  return (await get(toDeploymentKey(packageName, targetType, packageHash))) === DeploymentResult.passed
}

const setDeploymentResult = (targetType: TargetType, set: Set) => async (
  packageName: string,
  packageHash: string,
  isDeployed: boolean,
): Promise<void> => {
  await set(
    toDeploymentKey(packageName, targetType, packageHash),
    isDeployed ? DeploymentResult.passed : DeploymentResult.failed,
  )
}

const isPublishRun = (targetType: TargetType, has: Has) => async (
  packageName: string,
  packageHash: string,
): Promise<boolean> => {
  return has(toPublishKey(packageName, targetType, packageHash))
}

const setAsFailed = (targetType: TargetType, set: Set) => async (
  packageName: string,
  packageHash: string,
): Promise<void> => {
  return set(
    toPublishKey(packageName, targetType, packageHash),
    '' /* falsy value to indicate that we failed to publish */,
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
  const result = await get(toPublishKey(packageName, targetType, packageHash))
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
  isInRegistry,
  targetType,
}: {
  get: Get
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
    return {
      shouldPublish: false,
      publishSucceed: false,
      failureReason: `nothing changed and publish already failed in last builds.`,
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

  let npm: Cache['publish'][TargetType.npm] | undefined
  if (targetsInfo?.npm) {
    const { registry } = targetsInfo.npm
    npm = {
      isPublishRun: isPublishRun(TargetType.npm, has),
      setAsFailed: setAsFailed(TargetType.npm, set),
      isPublished: isPackagePublished({
        get,
        targetType: TargetType.npm,
        isInRegistry: (packageName, packageVersion) =>
          isNpmVersionAlreadyPulished({ packageName, packageVersion, npmRegistry: registry }),
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
        get,
        targetType: TargetType.docker,
        isInRegistry: (packageName, packageVersion) =>
          isDockerVersionAlreadyPulished({
            dockerOrganizationName: targetInfo.dockerOrganizationName,
            dockerRegistry: targetInfo.registry,
            imageTag: packageVersion,
            packageName,
            publishAuth: targetInfo.publishAuth,
          }),
      }),
      setAsPublished: setAsPublished({
        set,
        targetType: TargetType.docker,
      }),
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
    cleanup: () => Promise.all([redisClient.quit(), nodeCache.close()]),
  }
}
