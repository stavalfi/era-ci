import { getEventsTopicName } from '@era-ci/core'
import { startQuayHelperService } from '@era-ci/quay-helper-service'
import { startQuayMockService } from '@era-ci/quay-mock-service'
import chance from 'chance'
import Redis from 'ioredis'
import { starGittServer } from './git-server-testkit'
import { GetCleanups, TestProcessEnv, TestResources } from './types'

export function resourcesBeforeAfterEach(options: {
  getProcessEnv: () => TestProcessEnv
  getCleanups: GetCleanups
  startQuayHelperService?: boolean
  startQuayMockService?: boolean
}): () => TestResources {
  let resources: TestResources

  beforeEach(async () => {
    const processEnv = options.getProcessEnv()
    const dockerRegistry = `http://localhost:35000`
    const redisServerUrl = `redis://localhost:36379/0`
    const quayNamespace = `org-${chance().hash().slice(0, 8)}`
    const quayToken = `quay-token-${chance().hash().slice(0, 8)}`
    const redisFlowEventsSubscriptionsConnection = new Redis('localhost:36379', {
      showFriendlyErrorStack: true,
      lazyConnect: true,
    })

    const [quayMockService, quayHelperService, gitServer] = await Promise.all([
      options?.startQuayMockService
        ? await startQuayMockService({
            isTestMode: true,
            dockerRegistryAddress: dockerRegistry,
            namespace: quayNamespace,
            rateLimit: {
              max: 100000,
              timeWindowMs: 1000,
            },
            token: quayToken,
          })
        : Promise.resolve({ address: '', cleanup: () => Promise.resolve() }),
      options?.startQuayHelperService
        ? await startQuayHelperService({
            PORT: '0',
            REDIS_ADDRESS: redisServerUrl,
            ...processEnv,
          })
        : Promise.resolve({ address: '', cleanup: () => Promise.resolve() }),
      await starGittServer(),
      redisFlowEventsSubscriptionsConnection
        .connect()
        .then(() => redisFlowEventsSubscriptionsConnection.subscribe(getEventsTopicName(processEnv))),
    ])
    options.getCleanups().cleanups.push(quayMockService.cleanup)
    options.getCleanups().cleanups.push(quayHelperService.cleanup)
    options.getCleanups().cleanups.push(gitServer.close)
    options.getCleanups().connectionCleanups.push(async () => {
      redisFlowEventsSubscriptionsConnection.disconnect()
      // eslint-disable-next-line no-console
      console.log(`disconnected redis-flow-events-subscriptions connection. topic: "${getEventsTopicName(processEnv)}"`)
    })

    resources = {
      npmRegistry: {
        address: `http://localhost:34873`,
        auth: {
          username: 'root',
          token: 'root',
          email: 'root@root.root',
        },
      },
      dockerRegistry,
      redisServerUrl,
      gitServer,
      quayNamespace,
      quayToken,
      quayMockService,
      quayBuildStatusChangedRedisTopic: processEnv['QUAY_BUILD_STATUS_CHANED_TEST_REDIS_TOPIC'],
      quayHelperService,
      redisFlowEventsSubscriptionsConnection,
    }
  })

  return () => resources
}
