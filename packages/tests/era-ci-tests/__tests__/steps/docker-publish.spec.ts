import { createTest } from '@era-ci/e2e-tests-infra'
import { dockerPublish, npmPublish, NpmScopeAccess } from '@era-ci/steps'
import { createLinearStepsGraph } from '@era-ci/steps-graph'
import { localSequentalTaskQueue } from '@era-ci/task-queues'
import { TargetType } from '@era-ci/utils'

const { createRepo, getResources } = createTest()

test('docker-artifact depends on published npm-artifact during docker-build', async () => {
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
            RUN wget ${getResources().npmRegistry.address.replace('localhost', 'host.docker.internal')}/${toActualName(
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
          buildAndPushOnlyTempVersion: false,
        }),
      ]),
    },
  }))

  const { passed, published, jsonReport } = await runCi()
  expect(passed).toBeTruthy()
  expect(published.get('a')?.docker.tags.sort()).toEqual(
    [`artifact-hash-${jsonReport.artifacts[0].data.artifact.packageHash}`, await gitHeadCommit()].sort(),
  )
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
          buildAndPushOnlyTempVersion: false,
        }),
      ]),
    },
  })

  const { published, jsonReport } = await runCi()

  expect(published.get('a')?.docker.tags.sort()).toEqual(
    [`artifact-hash-${jsonReport.artifacts[0].data.artifact.packageHash}`, await gitHeadCommit()].sort(),
  )
})

test('publish with hash-tag', async () => {
  const { runCi } = await createRepo({
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
          buildAndPushOnlyTempVersion: true,
        }),
      ]),
    },
  })

  const { published, jsonReport } = await runCi()

  expect(published.get('a')?.docker.tags).toEqual([
    `artifact-hash-${jsonReport.artifacts[0].data.artifact.packageHash}`,
  ])
})

test('publish with hash-tag and then with semver-tag', async () => {
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
          buildAndPushOnlyTempVersion: true,
        }),
      ]),
    },
  })

  await runCi()

  const { published, jsonReport } = await runCi({
    processEnv: {
      BUILD_AND_PUSH_ONLY_TEMP_VERSION: '',
    },
  })

  expect(published.get('a')?.docker.tags.sort()).toEqual(
    [`artifact-hash-${jsonReport.artifacts[0].data.artifact.packageHash}`, await gitHeadCommit()].sort(),
  )
})

test('publish with hash-tag twice', async () => {
  const { runCi } = await createRepo({
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
          buildAndPushOnlyTempVersion: true,
        }),
      ]),
    },
  })

  await runCi()

  const { published, jsonReport } = await runCi()

  expect(published.get('a')?.docker.tags).toEqual([
    `artifact-hash-${jsonReport.artifacts[0].data.artifact.packageHash}`,
  ])
})

test('publish with semver-tag twice', async () => {
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
          buildAndPushOnlyTempVersion: false,
        }),
      ]),
    },
  })

  await runCi()

  const { published, jsonReport } = await runCi()

  expect(published.get('a')?.docker.tags.sort()).toEqual(
    [`artifact-hash-${jsonReport.artifacts[0].data.artifact.packageHash}`, await gitHeadCommit()].sort(),
  )
})
