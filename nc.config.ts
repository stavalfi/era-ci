/* eslint-disable no-process-env */

import { ConfigFileOptions } from './packages/nc/src/index'
import * as ciEnv from 'ci-env'

export default async (): Promise<ConfigFileOptions> => {
  const redisServer = process.env['REDIS_ENDPOINT']?.split(':') as string[]

  return {
    dockerOrganizationName: 'stavalfi',
    dockerRegistry: {
      host: 'registry.hub.docker.com',
      port: 443,
      protocol: 'https',
    },
    gitOrganizationName: 'stavalfi',
    gitRepositoryName: 'nc',
    gitServer: {
      host: 'github.com',
      port: 443,
      protocol: 'https',
    },
    npmRegistry: {
      host: 'registry.npmjs.com',
      port: 443,
      protocol: 'https',
    },
    redisServer: {
      host: redisServer[0],
      port: Number(redisServer[1]),
    },
    shouldPublish: Boolean(ciEnv.ci && ciEnv.pull_request_number === undefined),
    auth: {
      gitServerToken: process.env['GIT_SERVER_TOKEN'] as string,
      gitServerUsername: process.env['GIT_SERVER_USERNAME'] as string,
      npmRegistryEmail: 'stavalfi@gmail.com',
      npmRegistryToken: process.env['NPM_TOKEN'] as string,
      npmRegistryUsername: process.env['NPM_USERNAME'] as string,
      dockerRegistryToken: process.env['DOCKER_HUB_TOKEN'] as string,
      dockerRegistryUsername: process.env['DOCKER_HUB_USERNAME'] as string,
      redisPassword: process.env['REDIS_PASSWORD'] as string,
    },
  }
}
