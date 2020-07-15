import { logger } from '@tahini/log'
import Redis from 'ioredis'
import semver from 'semver'
import { isDockerVersionAlreadyPulished } from './docker-utils'
import { isNpmVersionAlreadyPulished } from './npm-utils'
import { Auth, Cache, CacheTypes, PackageVersion, ServerInfo, TargetType } from './types'

const log = logger('cache')

const DEFAULT_TTL = 1000 * 60 * 24 * 30

export const toPublishKey = (packageName: string, targetType: TargetType, packageHash: string) =>
  `${CacheTypes.publish}-${packageName}-${targetType}-${packageHash}`

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
  const redisClient = new Redis({
    host: redisServer.host,
    port: redisServer.port,
    ...(auth.redisPassword && { password: auth.redisPassword }),
  })

  async function get(key: string): Promise<string | null> {
    return redisClient.get(key)
  }

  async function set(key: string, value: string | number, ttlMs: number): Promise<void> {
    await redisClient.set(key, value, 'px', ttlMs)
  }

  const isPublished = (targetType: TargetType) => async (
    packageName: string,
    packageHash: string,
  ): Promise<PackageVersion | false> => {
    async function checkInCache() {
      const result = await get(toPublishKey(packageName, targetType, packageHash))
      if (!result) {
        return false
      } else {
        if (semver.valid(result)) {
          return result
        } else {
          log.debug(
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

  const setAsPublished = (targetType: TargetType) => async (
    packageName: string,
    packageHash: string,
    packageVersion: string,
  ): Promise<void> => {
    await set(toPublishKey(packageName, targetType, packageHash), packageVersion, DEFAULT_TTL)
  }

  return {
    publish: {
      npm: {
        isPublished: isPublished(TargetType.npm),
        setAsPublished: setAsPublished(TargetType.npm),
      },
      docker: {
        isPublished: isPublished(TargetType.docker),
        setAsPublished: setAsPublished(TargetType.docker),
      },
    },
    disconnect: () => redisClient.quit(),
  }
}
