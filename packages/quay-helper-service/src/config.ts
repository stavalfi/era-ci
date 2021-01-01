import { QUAY_BUILD_STATUS_CHANED_REDIS_TOPIC } from '@era-ci/task-queues'
import { Config } from './types'

export function getConfig(env: Record<string, string | undefined>): Config {
  if (!env.REDIS_ADDRESS) {
    throw new Error(`missing REDIS_ADDRESS in process.env`)
  }
  return {
    auth: {
      github: {
        token: env.GITHUB_TOKEN!,
      },
      bitbucketCloud: {
        username: env.BITBUCKET_CLOUD_USERNAME!,
        token: env.BITBUCKET_CLOUD_TOKEN!,
      },
    },
    port: env.PORT === undefined ? 8080 : Number(env.PORT),
    redisAddress: env.REDIS_ADDRESS,
    quayBuildStatusChangedRedisTopic:
      env.QUAY_BUILD_STATUS_CHANED_TEST_REDIS_TOPIC || QUAY_BUILD_STATUS_CHANED_REDIS_TOPIC,
  }
}
