import { createTest, isDeepSubset } from '@era-ci/e2e-tests-infra'
import { dockerPublish, k8sDeployment } from '@era-ci/steps'
import { createLinearStepsGraph } from '@era-ci/steps-graph'
import { localSequentalTaskQueue } from '@era-ci/task-queues'
import { execaCommand, ExecutionStatus, Status } from '@era-ci/utils'
import { test, expect } from '@jest/globals'
import _ from 'lodash'

const { createRepo, getResources, k8sHelpers } = createTest({ isK8sTestFile: true })

test('redeploy to k8s and ensure the new image is running', async () => {
  const { runCi, toActualName, testLog } = await createRepo(toActualName => ({
    repo: {
      packages: [
        {
          name: 'a1',
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
          additionalFiles: {
            Dockerfile: `\
            FROM quay.io/eraci/node:15.7.0-alpine3.10
            WORKDIR /usr/service
            RUN apk add curl # we install it to ensure (at the end of the test) the correct image is running 
            COPY packages/${toActualName('a1')}/src/ src/
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
    containerName: toActualName('a1'),
    deploymentName: toActualName('a1'),
    fullImageName: 'nginx:1.18.0',
    labels: { app: toActualName('a1') },
    podName: toActualName('a1'),
    portInContainer: 80,
  })

  const { passed } = await runCi()
  expect(passed).toBeTruthy()

  const podName = await k8sHelpers.findPodName(toActualName('a1'))

  const { stdout } = await execaCommand(`kubectl exec ${podName} -- curl localhost:80`, {
    log: testLog,
    stdio: 'pipe',
  })
  expect(stdout).toEqual('alive123')
})

test('era-ci try to redeploy a deployment which does not exist', async () => {
  const { runCi, toActualName } = await createRepo(toActualName => ({
    repo: {
      packages: [
        {
          name: 'a2',
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
          additionalFiles: {
            Dockerfile: `\
            FROM quay.io/eraci/node:15.7.0-alpine3.10
            WORKDIR /usr/service
            COPY packages/${toActualName('a2')}/src/ src/
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
          artifactNameToContainerName: ({ artifactName }) => toActualName(artifactName),
          artifactNameToDeploymentName: ({ artifactName }) => toActualName(artifactName),
          kubeConfigBase64: getResources().k8s.kubeConfigBase64,
          failDeplomentOnPodError: true,
        }),
      ]),
    },
  }))

  const { passed, flowLogs } = await runCi()
  expect(passed).toBeFalsy()
  expect(flowLogs).toEqual(expect.stringContaining(`deployments.apps \\"${toActualName('a2')}\\" not found`))
})

test('failDeplomentOnPodError=true - redeploy to k8s fails because the new image throw exceptions - ensure the ci notify about a pod error', async () => {
  const { runCi, toActualName } = await createRepo(toActualName => ({
    repo: {
      packages: [
        {
          name: 'a3',
          version: '1.0.0',
          packageJsonRecords: {
            deployable: true,
          },
          src: {
            'index.js': 'throw new Error("error-123")',
          },
          additionalFiles: {
            Dockerfile: `\
            FROM quay.io/eraci/node:15.7.0-alpine3.10
            WORKDIR /usr/service
            RUN apk add curl # we install it to ensure (at the end of the test) the correct image is running 
            COPY packages/${toActualName('a3')}/src/ src/
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
    containerName: toActualName('a3'),
    deploymentName: toActualName('a3'),
    fullImageName: 'nginx:1.18.0',
    labels: { app: toActualName('a3') },
    podName: toActualName('a3'),
    portInContainer: 80,
    // in some rare cases, k8s sends pod-event that the pod is ok (for a very short moment) and then it will send the crush-pod-event.
    // that's a problem because k8s-step will think that the deployment was successful. so we tell k8s to wait at least `minReadySeconds`
    // on every new pod, before k8s send un pod-event about pod-success.
    minReadySeconds: 5,
  })

  const { passed, jsonReport } = await runCi()
  expect(passed).toBeFalsy()

  const notes: string[] = _.get(jsonReport, [
    'stepsResultOfArtifactsByStep',
    1,
    'data',
    'artifactsResult',
    0,
    'data',
    'artifactStepResult',
    'notes',
  ])

  expect(notes).toEqual([
    expect.stringMatching(
      /failed to deploy. reason: pod: "(.*)" failed to run\. manually check the problem, commit a fix and run the CI again/,
    ),
  ])
})

test('failDeplomentOnPodError=false, progressDeadlineSeconds=8 - redeploy to k8s fails because the new image throw exceptions -  ensure the ci notify about a deployment timeout', async () => {
  const { runCi, toActualName } = await createRepo(toActualName => ({
    repo: {
      packages: [
        {
          name: 'a4',
          version: '1.0.0',
          packageJsonRecords: {
            deployable: true,
          },
          src: {
            'index.js': 'throw new Error("error-123")',
          },
          additionalFiles: {
            Dockerfile: `\
            FROM quay.io/eraci/node:15.7.0-alpine3.10
            WORKDIR /usr/service
            RUN apk add curl # we install it to ensure (at the end of the test) the correct image is running 
            COPY packages/${toActualName('a4')}/src/ src/
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
          artifactNameToContainerName: ({ artifactName }) => toActualName(artifactName),
          artifactNameToDeploymentName: ({ artifactName }) => toActualName(artifactName),
          kubeConfigBase64: getResources().k8s.kubeConfigBase64,
          failDeplomentOnPodError: false,
        }),
      ]),
    },
  }))

  // this deployment will be redeployed to different image (from the Dockerfile above)
  await k8sHelpers.createK8sDeployment({
    namespaceName: 'default',
    containerName: toActualName('a4'),
    deploymentName: toActualName('a4'),
    fullImageName: 'nginx:1.18.0',
    labels: { app: toActualName('a4') },
    podName: toActualName('a4'),
    portInContainer: 80,
    progressDeadlineSeconds: 8,
  })

  const { passed, jsonReport } = await runCi()
  expect(passed).toBeFalsy()

  const notes: string[] = _.get(jsonReport, [
    'stepsResultOfArtifactsByStep',
    1,
    'data',
    'artifactsResult',
    0,
    'data',
    'artifactStepResult',
    'notes',
  ])

  expect(notes).toEqual([
    `failed to deploy. reason: the specified timeout (progressDeadlineSeconds) was reached: "8" seconds. manually check the problem, commit a fix and run the CI again`,
  ])
})

test('running the flow again will cause to redeploy to k8s the same image again - ensure it does not hang the flow', async () => {
  const { runCi, toActualName } = await createRepo(toActualName => ({
    repo: {
      packages: [
        {
          name: 'a5',
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
          additionalFiles: {
            Dockerfile: `\
            FROM quay.io/eraci/node:15.7.0-alpine3.10
            WORKDIR /usr/service
            RUN apk add curl # we install it to ensure (at the end of the test) the correct image is running 
            COPY packages/${toActualName('a5')}/src/ src/
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
    containerName: toActualName('a5'),
    deploymentName: toActualName('a5'),
    fullImageName: 'nginx:1.18.0',
    labels: { app: toActualName('a5') },
    podName: toActualName('a5'),
    portInContainer: 80,
  })

  await runCi()

  const { passed, jsonReport } = await runCi()
  expect(passed).toBeTruthy()

  expect(
    isDeepSubset(jsonReport, {
      stepsResultOfArtifactsByStep: [
        {
          data: {
            stepInfo: {
              stepName: 'k8s-deployment',
            },
            artifactsResult: [
              {
                data: {
                  artifactStepResult: {
                    executionStatus: ExecutionStatus.aborted,
                    status: Status.skippedAsPassed,
                    notes: ['nothing new to deploy'],
                  },
                },
              },
            ],
          },
        },
      ],
    }),
  ).toBeTruthy()
})
