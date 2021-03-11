import { createTest } from '@era-ci/e2e-tests-infra'
import { dockerPublish, k8sDeployment } from '@era-ci/steps'
import { createLinearStepsGraph } from '@era-ci/steps-graph'
import { localSequentalTaskQueue } from '@era-ci/task-queues'
import { execaCommand } from '@era-ci/utils'
import { expect, test } from '@jest/globals'

const { createRepo, getResources, k8sHelpers } = createTest({ isK8sTestFile: true })

test('deploy a package using image from different package and ensure only one package was deployed', async () => {
  const { runCi, toActualName, testLog } = await createRepo(toActualName => ({
    repo: {
      packages: [
        {
          name: 'a40',
          version: '1.0.0',
          packageJsonRecords: {
            deployable: true,
          },
          src: {
            'index.js': `
              require('http')
                  .createServer((_req, res) => (res.writeHead(200), res.end('alive123')))
                  .listen(80)
              `,
          },
          devDependencies: {
            b40: '1.0.0',
          },
        },
        {
          name: 'b40',
          version: '1.0.0',
          additionalFiles: {
            Dockerfile: `\
              FROM quay.io/eraci/node:15.7.0-alpine3.10
              WORKDIR /usr/service
              RUN apk add curl # we install it to ensure (at the end of the test) the correct image is running 
              COPY packages/${toActualName('a40')}/src/ src/
              CMD node ./src/index.js
              `,
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
          useImageFromPackageName: () => toActualName('b40'),
          artifactNameToContainerName: ({ artifactName }) => toActualName(artifactName),
          artifactNameToDeploymentName: ({ artifactName }) => toActualName(artifactName),
          kubeConfigBase64: getResources().k8s.kubeConfigBase64,
          failDeplomentOnPodError: true,
        }),
      ]),
    },
  }))

  // this deployment will be redeployed to different image (from the Dockerfile above)
  await k8sHelpers.createK8sDeployment({
    namespaceName: 'default',
    containerName: toActualName('a40'),
    deploymentName: toActualName('a40'),
    fullImageName: 'nginx:1.18.0',
    labels: { app: toActualName('a40') },
    podName: toActualName('a40'),
    portInContainer: 80,
  })

  const { passed } = await runCi()
  expect(passed).toBeTruthy()

  const podName = await k8sHelpers.findPodName(toActualName('a40'))

  const { stdout } = await execaCommand(`kubectl exec ${podName} -- curl localhost:80`, {
    log: testLog,
    stdio: 'pipe',
  })
  expect(stdout).toEqual('alive123')

  await expect(k8sHelpers.findPodName(toActualName('b40'))).resolves.toBeFalsy()
})
