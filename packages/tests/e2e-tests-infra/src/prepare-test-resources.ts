import { GitServer, starGittServer } from './git-server-testkit'
import { TestResources } from './types'
import { startQuayHelperService } from '@tahini/quay-helper-service'
import { startQuayMockService } from '@tahini/quay-mock-service'
import chance from 'chance'

type Deployment = { address: string; cleanup: () => Promise<unknown> }

export function resourcesBeforeAfterAll(): {
  getResources: () => TestResources
} {
  let dockerRegistry: Deployment
  let npmRegistryDeployment: Deployment
  let redisDeployment: Deployment
  let quayMockService: Deployment
  let quayHelperService: Deployment
  let gitServer: GitServer
  let quayNamespace: string
  let quayToken: string
  let quayBuildStatusChangedRedisTopic: string

  // verdaccio allow us to login as any user & password & email
  const verdaccioCardentials = {
    username: 'root',
    token: 'root',
    email: 'root@root.root',
  }

  beforeEach(async () => {
    gitServer = await starGittServer()
    npmRegistryDeployment = {
      cleanup: () => Promise.resolve(),
      address: `http://localhost:34873`,
    }
    redisDeployment = {
      cleanup: () => Promise.resolve(),
      address: `redis://localhost:36379/0`,
    }
    dockerRegistry = {
      cleanup: () => Promise.resolve(),
      address: `http://localhost:35000`,
    }
    quayNamespace = `org-${chance().hash().slice(0, 8)}`
    quayToken = `quay-token-${chance().hash().slice(0, 8)}`
    quayMockService = await startQuayMockService({
      dockerRegistryAddress: dockerRegistry.address,
      namespace: quayNamespace,
      rateLimit: {
        max: 100000,
        timeWindowMs: 1000,
      },
      token: quayToken,
    })
    quayBuildStatusChangedRedisTopic = `redis-topic-${chance().hash().slice(0, 8)}`
    // eslint-disable-next-line no-process-env
    process.env.QUAY_BUILD_STATUS_CHANED_TEST_REDIS_TOPIC = quayBuildStatusChangedRedisTopic
    quayHelperService = await startQuayHelperService({
      PORT: '0',
      REDIS_ADDRESS: redisDeployment.address,
      QUAY_BUILD_STATUS_CHANED_TEST_REDIS_TOPIC: quayBuildStatusChangedRedisTopic,
      NC_TEST_MODE: 'true',
    })
  })
  afterEach(async () => {
    await Promise.allSettled(
      [
        gitServer && gitServer.close(),
        npmRegistryDeployment && npmRegistryDeployment.cleanup(),
        redisDeployment && redisDeployment.cleanup(),
        dockerRegistry && dockerRegistry.cleanup(),
        quayMockService && quayMockService.cleanup(),
        quayHelperService && quayHelperService.cleanup(),
      ].filter(Boolean),
    )
  })

  return {
    getResources: (): TestResources => ({
      npmRegistry: {
        address: npmRegistryDeployment.address,
        auth: verdaccioCardentials,
      },
      dockerRegistry: dockerRegistry.address,
      redisServerUri: redisDeployment.address,
      redisServerHost: 'localhost',
      redisServerPort: 36379,
      gitServer,
      quayNamespace,
      quayToken,
      quayMockService: quayMockService.address,
      quayBuildStatusChangedRedisTopic,
      quayHelperService: quayHelperService.address,
    }),
  }
}
