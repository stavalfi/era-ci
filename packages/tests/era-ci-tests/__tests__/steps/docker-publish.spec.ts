import { createTest } from '@era-ci/e2e-tests-infra'
import { dockerPublish, npmPublish, NpmScopeAccess } from '@era-ci/steps'
import { createLinearStepsGraph } from '@era-ci/steps-graph'
import { localSequentalTaskQueue } from '@era-ci/task-queues'
import { TargetType } from '@era-ci/utils'
import expect from 'expect'

const { createRepo, getResources } = createTest()

test('docker-artifact depends on published npm-artifact during docker-build', async () => {
  // eslint-disable-next-line no-process-env
  // const hostIp = process.env.GITHUB_RUN_NUMBER ? `172.17.0.1` : 'host.docker.internal' // it seems that 'host.docker.internal' stopped working for mac and now, `172.17.0.1` is working for mac.
  const hostIp = `172.17.0.1`
  const { runCi, gitHeadCommit } = await createRepo(toActualName => ({
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          additionalFiles: {
            Dockerfile: `\
            FROM alpine
            RUN apk add wget
            RUN wget ${getResources().npmRegistry.address.replace('localhost', hostIp)}/${toActualName(
              'b',
            )}/-/${toActualName('b')}-2.0.0.tgz
            CMD ["echo","hello"]
            `,
          },
          dependencies: {
            b: '2.0.0',
          },
        },
        {
          name: 'b',
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
          publishAuth: getResources().npmRegistry.auth,
        }),
        dockerPublish({
          isStepEnabled: true,
          dockerOrganizationName: getResources().quayNamespace,
          registry: getResources().dockerRegistry,
          imageInstallArtifactsFromNpmRegistry: true,
        }),
      ]),
    },
  }))

  const { passed, published } = await runCi()
  expect(passed).toBeTruthy()
  expect(published.get('a')?.docker.tags).toEqual([await gitHeadCommit()])
  expect(published.get('b')?.npm.versions).toEqual(['2.0.0'])
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
          registry: getResources().dockerRegistry,
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
          registry: getResources().dockerRegistry,
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
          registry: getResources().dockerRegistry,
          imageInstallArtifactsFromNpmRegistry: true,
        }),
      ]),
    },
  })

  const { published } = await runCi()

  expect(published.get('@scope1/a1')?.docker.tags).toEqual([await gitHeadCommit()])
})
