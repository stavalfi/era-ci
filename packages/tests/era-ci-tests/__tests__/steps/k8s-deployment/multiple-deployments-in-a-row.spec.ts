import { createTest } from '@era-ci/e2e-tests-infra'
import { dockerPublish, k8sDeployment } from '@era-ci/steps'
import { createLinearStepsGraph } from '@era-ci/steps-graph'
import { localSequentalTaskQueue } from '@era-ci/task-queues'
import { execaCommand } from '@era-ci/utils'
import expect from 'expect'
import fs from 'fs'
import _ from 'lodash'
import path from 'path'

const { createRepo, getResources, k8sHelpers } = createTest({ isK8sTestFile: true })

test('2 deployments - all succeed', async () => {
  const { runCi, toActualName, testLog, repoPath } = await createRepo(toActualName => ({
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
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
            COPY packages/${toActualName('a')}/src/ src/
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
    containerName: toActualName('a'),
    deploymentName: toActualName('a'),
    fullImageName: 'nginx:1.18.0-alpine',
    labels: { app: toActualName('a') },
    podName: toActualName('a'),
    portInContainer: 80,
  })

  await runCi()

  await fs.promises.writeFile(
    path.join(repoPath, 'packages', toActualName('a'), 'src', 'index.js'),
    `require('http')
        .createServer((_req, res) => (res.writeHead(200), res.end('alive1234')))
        .listen(80)
            `,
    'utf-8',
  )
  await execaCommand(`git commit -am wip && git push`, { cwd: repoPath, stdio: 'pipe', shell: true, log: testLog })

  const { passed } = await runCi()
  expect(passed).toBeTruthy()

  const podName = await k8sHelpers.findPodName(toActualName('a'))

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
          name: 'a',
          version: '1.0.0',
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
            COPY packages/${toActualName('a')}/src/ src/
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
    containerName: toActualName('a'),
    deploymentName: toActualName('a'),
    fullImageName: 'nginx:1.18.0-alpine',
    labels: { app: toActualName('a') },
    podName: toActualName('a'),
    portInContainer: 80,
  })

  await runCi()

  await fs.promises.writeFile(
    path.join(repoPath, 'packages', toActualName('a'), 'src', 'index.js'),
    `throew new Error("123")`,
    'utf-8',
  )
  await execaCommand(`git commit -am wip && git push`, { cwd: repoPath, stdio: 'pipe', shell: true, log: testLog })

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
