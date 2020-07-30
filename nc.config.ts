/* eslint-disable no-process-env */

import { ConfigFileOptions } from './packages/nc/src/index'
import ciInfo from 'ci-info'

export default async (): Promise<ConfigFileOptions<number>> => {
  const { DOCKER_HUB_USERNAME, DOCKER_HUB_TOKEN, NPM_USERNAME, NPM_TOKEN, REDIS_PASSWORD, REDIS_ENDPOINT } = process.env

  const isMasterBuild = Boolean(ciInfo.isCI && !ciInfo.isPR)

  return {
    shouldPublish: isMasterBuild,
    shouldDeploy: isMasterBuild,
    dockerOrganizationName: 'stavalfi',
    dockerRegistryUrl: `https://${DOCKER_HUB_USERNAME}:${DOCKER_HUB_TOKEN}@registry.hub.docker.com/`,
    redisServerUrl: `redis://:${REDIS_PASSWORD}@${REDIS_ENDPOINT}/`,
    npmRegistryEmail: 'stavalfi@gmail.com',
    npmRegistryUrl: `https://${NPM_USERNAME}:${NPM_TOKEN}@registry.npmjs.com/`,
    deployment: {
      npm: {
        initializeDeploymentClient: async () => 2,
        deploy: async ({ artifactToDeploy, deploymentClient }) => Promise.resolve(),
        destroyDeploymentClient: async () => Promise.resolve(),
      },
      docker: {
        initializeDeploymentClient: async () => 2,
        deploy: async () => Promise.resolve(),
        destroyDeploymentClient: async () => Promise.resolve(),
      },
    },
  }
}
