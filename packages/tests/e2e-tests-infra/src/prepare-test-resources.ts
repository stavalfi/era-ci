import { getEventsTopicName } from '@era-ci/core'
import { startQuayHelperService } from '@era-ci/quay-helper-service'
import { startQuayMockService } from '@era-ci/quay-mock-service'
import { beforeEach } from '@jest/globals'
import * as k8s from '@kubernetes/client-node'
import chance from 'chance'
import fs from 'fs'
import Redis from 'ioredis'
import os from 'os'
import path from 'path'
import { npmRegistryLogin } from '@era-ci/steps'
import { starGittServer } from './git-server-testkit'
import { GetCleanups, TestProcessEnv, TestResources } from './types'

async function k8sResources(
  isK8sTestFile?: boolean,
): Promise<{
  kubeConfigBase64: string
  deploymentApi: k8s.AppsV1Api
}> {
  const kc = new k8s.KubeConfig()

  if (isK8sTestFile) {
    const kubeConfigFile = await fs.promises.readFile(path.join(os.homedir(), '.kube', 'config'), 'utf-8')
    if (!kubeConfigFile.includes('current-context: k3d-era-ci-test')) {
      const currentConetxt = kubeConfigFile.split('current-context: ')[1].split('\n')[0]
      throw new Error(
        `for extra precution to avoid running era-ci tests on your production k8s cluster, \
        we only allow to run era-ci tests on k3d and set the cluster name to "default". please change your current-context. current-context: "${currentConetxt}"`,
      )
    }

    const kubeConfigBase64 = Buffer.from(kubeConfigFile).toString('base64')

    kc.loadFromString(kubeConfigFile)

    return {
      kubeConfigBase64,
      deploymentApi: kc.makeApiClient(k8s.AppsV1Api),
    }
  } else {
    return {
      kubeConfigBase64: 'invalid-kubeconfig-file',
      // if you see this, it means that you are running k8s tests. run: const .... = createTest({ isK8sTestFile: true })
      // test-file example: packages/tests/era-ci-tests/__tests__/steps/k8s-deployment/happy-flows.spec.ts
      // @ts-expect-error
      deploymentApi: null,
    }
  }
}

export function resourcesBeforeAfterEach(options: {
  getProcessEnv: () => TestProcessEnv
  getCleanups: GetCleanups
  startQuayHelperService?: boolean
  startQuayMockService?: boolean
  isK8sTestFile?: boolean
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
    const npmRegistry = {
      address: `http://localhost:34873`,
      auth: {
        username: 'username',
        password: 'password',
        email: 'root@root.root',
      },
    }

    const [k8s, quayMockService, quayHelperService, gitServer] = await Promise.all([
      k8sResources(options.isK8sTestFile),
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
      npmRegistryLogin({
        npmRegistry: npmRegistry.address,
        npmRegistryEmail: npmRegistry.auth.email,
        npmRegistryPassword: npmRegistry.auth.password,
        npmRegistryUsername: npmRegistry.auth.username,
      }),
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
      k8s,
      npmRegistry,
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
