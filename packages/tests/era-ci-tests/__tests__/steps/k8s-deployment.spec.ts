import { createTest } from '@era-ci/e2e-tests-infra'
import { dockerPublish, k8sDeployment } from '@era-ci/steps'
import { createLinearStepsGraph } from '@era-ci/steps-graph'
import { localSequentalTaskQueue } from '@era-ci/task-queues'
import * as k8s from '@kubernetes/client-node'
import chance from 'chance'
import expect from 'expect'
import fs from 'fs'
import os from 'os'
import path from 'path'

const { createRepo, getResources, getCleanups } = createTest()

export function isResourceAlreadyExistError(error?: {
  response?: { statusCode?: number; body?: { reason?: string } }
}): boolean {
  return error?.response?.statusCode === 409 && error?.response?.body?.reason === 'AlreadyExists'
}

const createDeployment = (deploymentApi: k8s.AppsV1Api) => (options: {
  deploymentName: string
  podName: string
  containerName: string
  fullImageName: string
  portInContainer: number
  labels: { app: string }
}) =>
  deploymentApi.createNamespacedDeployment('default', {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: {
      name: options.deploymentName,
      labels: options.labels,
    },
    spec: {
      replicas: 1,
      selector: {
        matchLabels: options.labels,
      },
      template: {
        metadata: {
          name: options.podName,
          labels: options.labels,
        },
        spec: {
          serviceAccount: '',
          containers: [
            {
              name: options.containerName,
              image: options.fullImageName,
              ports: [
                {
                  containerPort: options.portInContainer,
                },
              ],
            },
          ],
        },
      },
    },
  })

test('docker-artifact depends on published npm-artifact during docker-build', async () => {
  const kc = new k8s.KubeConfig()
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
  const apiClient = kc.makeApiClient(k8s.CoreV1Api)
  const deploymentApi = kc.makeApiClient(k8s.AppsV1Api)

  await apiClient
    .createNamespace({
      metadata: {
        name: 'default',
      },
    })
    .catch(error => !isResourceAlreadyExistError(error) && Promise.reject(error))

  const id = chance().hash().slice(0, 8)
  const deployment = await createDeployment(deploymentApi)({
    containerName: `container-${id}`,
    deploymentName: `deployment-${id}`,
    fullImageName: 'nginx:1.18.0-alpine',
    labels: { app: `label-${id}` },
    podName: `pod-${id}`,
    portInContainer: 80,
  })
  getCleanups().cleanups.push(() =>
    deploymentApi.deleteNamespacedDeployment(deployment.body.metadata?.name!, 'default'),
  )
  const { runCi } = await createRepo(toActualName => ({
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          src: {
            'index.js': `
            const http = require('http');

            const requestListener = function (req, res) {
              res.writeHead(200);
              res.end('alive1');
            }

            const server = http.createServer(requestListener);
            server.listen(8080);
            `,
          },
          additionalFiles: {
            Dockerfile: `\
            FROM quay.io/eraci/node:15.7.0-alpine3.10
            WORKDIR /usr/service
            COPY packages/${toActualName('a')}/src/ src/
            CMD node ./src/index.js
            `,
          },
          dependencies: {
            b: '2.0.0',
          },
        },
      ],
    },
    configurations: {
      taskQueues: [localSequentalTaskQueue()],
      steps: createLinearStepsGraph([
        dockerPublish({
          isStepEnabled: true,
          dockerOrganizationName: getResources().quayNamespace,
          dockerRegistry: getResources().dockerRegistry,
          imageInstallArtifactsFromNpmRegistry: true,
        }),
        k8sDeployment({
          isStepEnabled: true,
          k8sNamesapce: 'default',
          artifactNameToContainerName: () => `container-${id}`,
          artifactNameToDeploymentName: () => `deployment-${id}`,
          kubeConfigBase64: kubeConfigBase64,
        }),
      ]),
    },
  }))

  const { passed } = await runCi()
  expect(passed).toBeTruthy()
})
