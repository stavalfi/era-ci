import { startQuayHelperService } from '@era-ci/quay-helper-service'
import { startQuayMockService } from '@era-ci/quay-mock-service'
import { TestInterface } from 'ava'
import chance from 'chance'
import { starGittServer } from './git-server-testkit'
import { TestResources } from './types'

export function resourcesBeforeAfterAll(
  test: TestInterface<{ resources: TestResources }>,
  options?: {
    startQuayHelperService?: boolean
    startQuayMockService?: boolean
  },
): void {
  test.serial.before(async t => {
    // @ts-ignore
    t.context.resources = {}
    t.context.resources.gitServer = await starGittServer()
  })
  test.serial.after(async t => {
    await t.context.resources.gitServer.close()
  })
  test.serial.beforeEach(async t => {
    const dockerRegistry = `http://localhost:35000`
    const redisServerUrl = `redis://localhost:36379/0`
    const quayNamespace = `org-${chance().hash().slice(0, 8)}`
    const quayToken = `quay-token-${chance().hash().slice(0, 8)}`
    const quayBuildStatusChangedRedisTopic = `redis-topic-${chance().hash().slice(0, 8)}`
    t.context.resources = {
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
      redisServerHost: 'localhost',
      redisServerPort: 36379,
      gitServer: t.context.resources.gitServer,
      quayNamespace,
      quayToken,
      quayMockService: options?.startQuayMockService
        ? await startQuayMockService({
            dockerRegistryAddress: dockerRegistry,
            namespace: quayNamespace,
            rateLimit: {
              max: 100000,
              timeWindowMs: 1000,
            },
            token: quayToken,
            customLog: t.log.bind(t),
          })
        : { address: '', cleanup: () => Promise.resolve() },
      quayBuildStatusChangedRedisTopic,
      quayHelperService: options?.startQuayHelperService
        ? await startQuayHelperService(
            {
              PORT: '0',
              REDIS_ADDRESS: redisServerUrl,
              QUAY_BUILD_STATUS_CHANED_TEST_REDIS_TOPIC: quayBuildStatusChangedRedisTopic,
              NC_TEST_MODE: 'true',
            },
            t.log.bind(t),
          )
        : { address: '', cleanup: () => Promise.resolve() },
    }
  })
  test.serial.afterEach(async t => {
    await Promise.allSettled(
      [t.context.resources.quayMockService.cleanup(), t.context.resources.quayHelperService.cleanup()].filter(Boolean),
    )
  })
}
