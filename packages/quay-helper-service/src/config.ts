import { QUAY_BUILD_STATUS_CHANED_REDIS_TOPIC } from '@tahini/task-queues'
import { Config } from './types'

export function getConfig(env: Record<string, string | undefined>): Config {
  if (!env.REDIS_ADDRESS) {
    throw new Error(`missing REDIS_ADDRESS in process.env`)
  }
  return {
    auth: {
      github: {
        token: env.GITHUB_TOKEN || 'e228688513b757fcd0ef5bb00d662c2edb20c787',
      },
      bitbucketCloud: {
        username: env.BITBUCKET_CLOUD_USERNAME || 'stavalfi-octopol',
        token: env.BITBUCKET_CLOUD_TOKEN || 'dtJN7SynXH6HtbtWQ7db',
      },
    },
    port: env.PORT === undefined ? 8080 : Number(env.PORT),
    redisAddress: env.REDIS_ADDRESS,
    quayBuildStatusChangedRedisTopic:
      env.QUAY_BUILD_STATUS_CHANED_TEST_REDIS_TOPIC || QUAY_BUILD_STATUS_CHANED_REDIS_TOPIC,
  }
}