import { createTest } from '@era-ci/e2e-tests-infra'
import { dockerPublish, k8sDeployment } from '@era-ci/steps'
import { createLinearStepsGraph } from '@era-ci/steps-graph'
import { localSequentalTaskQueue } from '@era-ci/task-queues'
import { execaCommand } from '@era-ci/utils'
import { test, expect } from '@jest/globals'
import fs from 'fs'
import _ from 'lodash'
import path from 'path'

const { createRepo, getResources, k8sHelpers } = createTest({ isK8sTestFile: true })

test('2 deployments - all succeed', async () => {
  const { runCi, toActualName, testLog, repoPath } = await createRepo(toActualName => ({
    repo: {
      packages: [
        {
          name: 'a6',
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
            COPY packages/${toActualName('a6')}/src/ src/
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
    containerName: toActualName('a6'),
    deploymentName: toActualName('a6'),
    fullImageName: 'nginx:1.18.0',
    labels: { app: toActualName('a6') },
    podName: toActualName('a6'),
    portInContainer: 80,
  })

  await runCi()

  await fs.promises.writeFile(
    path.join(repoPath, 'packages', toActualName('a6'), 'src', 'index.js'),
    `require('http')
        .createServer((_req, res) => (res.writeHead(200), res.end('alive1234')))
        .listen(80)
            `,
    'utf-8',
  )
  await execaCommand(`git commit -am wip && git push`, {
    cwd: repoPath,
    stdio: 'pipe',
    shell: true,
    log: testLog,
  })

  const { passed } = await runCi()
  expect(passed).toBeTruthy()

  const podName = await k8sHelpers.findPodName(toActualName('a6'))

  const { stdout } = await execaCommand(`kubectl exec ${podName} -- curl localhost:80`, {
    log: testLog,
    stdio: 'pipe',
  })
  expect(stdout).toEqual('alive1234')
})

test('2 deployments - first succeed, second fail because of code-bug in the image', async () => {
  const { runCi, toActualName, testLog, repoPath } = await createRepo(toActualName => ({
    repo: {
      packages: [
        {
          name: 'a7',
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
            COPY packages/${toActualName('a7')}/src/ src/
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
    containerName: toActualName('a7'),
    deploymentName: toActualName('a7'),
    fullImageName: 'nginx:1.18.0',
    labels: { app: toActualName('a7') },
    podName: toActualName('a7'),
    portInContainer: 80,
    // in some rare cases, k8s sends pod-event that the pod is ok (for a very short moment) and then it will send the crush-pod-event.
    // that's a problem because k8s-step will think that the deployment was successful. so we tell k8s to wait at least `minReadySeconds`
    // on every new pod, before k8s send un pod-event about pod-success.
    minReadySeconds: 5,
  })

  await runCi()

  await fs.promises.writeFile(
    path.join(repoPath, 'packages', toActualName('a7'), 'src', 'index.js'),
    `throw new Error("123")`,
    'utf-8',
  )
  await execaCommand(`git commit -am wip && git push`, {
    cwd: repoPath,
    stdio: 'pipe',
    shell: true,
    log: testLog,
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
