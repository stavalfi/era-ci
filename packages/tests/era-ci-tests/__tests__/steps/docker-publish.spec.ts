import { createTest } from '@era-ci/e2e-tests-infra'
import { dockerPublish, npmPublish, NpmScopeAccess } from '@era-ci/steps'
import { createLinearStepsGraph } from '@era-ci/steps-graph'
import { localSequentalTaskQueue } from '@era-ci/task-queues'
import { TargetType } from '@era-ci/utils'
import { expect, test } from '@jest/globals'

const { createRepo, getResources } = createTest()

test('docker-artifact depends on published npm-artifact during docker-build', async () => {
  const hostIp = `172.17.0.1`
  const {
    npmRegistry: {
      auth: { email, password, username },
    },
  } = getResources()
  const registryAddress = getResources().npmRegistry.address.replace('localhost', hostIp)
  const { runCi, gitHeadCommit } = await createRepo(toActualName => ({
    repo: {
      packages: [
        {
          name: 'a24',
          version: '1.0.0',
          additionalFiles: {
            Dockerfile: `\
            FROM quay.io/eraci/node:15.7.0-alpine3.10
            RUN NPM_USER=${username} NPM_PASS="${password}" NPM_EMAIL=${email} NPM_REGISTRY=${registryAddress} npx npm-login-noninteractive && npm view ${toActualName(
              'b24',
            )}@2.0.0 --registry ${registryAddress}
            CMD ["echo","hello"]
            `,
          },
          dependencies: {
            b24: '2.0.0',
          },
        },
        {
          name: 'b24',
          version: '2.0.0',
          targetType: TargetType.npm,
        },
      ],
    },
    configurations: {
      taskQueues: [localSequentalTaskQueue()],
      steps: createLinearStepsGraph([
        npmPublish({
          isStepEnabled: true,
          npmScopeAccess: NpmScopeAccess.public,
          registry: getResources().npmRegistry.address,
          registryAuth: getResources().npmRegistry.auth,
        }),
        dockerPublish({
          isStepEnabled: true,
          dockerOrganizationName: getResources().quayNamespace,
          dockerRegistry: getResources().dockerRegistry,
          imageInstallArtifactsFromNpmRegistry: true,
        }),
      ]),
    },
  }))

  const { passed, published } = await runCi()
  expect(passed).toBeTruthy()
  expect(published.get('a24')?.docker.tags).toEqual([await gitHeadCommit()])
  expect(published.get('b24')?.npm.versions).toEqual(['2.0.0'])
})

test('publish with semver-tag', async () => {
  const { runCi, gitHeadCommit } = await createRepo({
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          targetType: TargetType.docker,
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
      ]),
    },
  })

  const { published } = await runCi()

  expect(published.get('a')?.docker.tags.sort()).toEqual([await gitHeadCommit()])
})

test('publish twice - expect that there is only one tag to the image in the registry', async () => {
  const { runCi, gitHeadCommit } = await createRepo({
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          targetType: TargetType.docker,
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
      ]),
    },
  })

  await runCi()

  const { published } = await runCi()

  expect(published.get('a')?.docker.tags.sort()).toEqual([await gitHeadCommit()])
})

test('artifact package-json name has @ symbol', async () => {
  const { runCi, gitHeadCommit } = await createRepo({
    repo: {
      packages: [
        {
          name: '@scope1/a1',
          version: '1.0.0',
          targetType: TargetType.docker,
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
      ]),
    },
  })

  const { published } = await runCi()

  expect(published.get('@scope1/a1')?.docker.tags).toEqual([await gitHeadCommit()])
})
