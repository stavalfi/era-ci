import { createRepo, createTest, test } from '@era-ci/e2e-tests-infra'
import { dockerPublish, npmPublish, NpmScopeAccess } from '@era-ci/steps'
import { createLinearStepsGraph } from '@era-ci/steps-graph'
import { localSequentalTaskQueue } from '@era-ci/task-queues'
import { TargetType } from '@era-ci/utils'
import expect from 'expect'

createTest(test)

test('docker-artifact depends on published npm-artifact during docker-build', async t => {
  // eslint-disable-next-line no-process-env
  const hostIp = process.env.GITHUB_RUN_NUMBER ? `172.17.0.1` : 'host.docker.internal'
  const { runCi, gitHeadCommit } = await createRepo(t, toActualName => ({
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          additionalFiles: {
            Dockerfile: `\
            FROM alpine
            RUN apk add wget
            RUN wget ${t.context.resources.npmRegistry.address.replace('localhost', hostIp)}/${toActualName(
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
          registry: t.context.resources.npmRegistry.address,
          publishAuth: t.context.resources.npmRegistry.auth,
        }),
        dockerPublish({
          isStepEnabled: true,
          dockerOrganizationName: t.context.resources.quayNamespace,
          registry: t.context.resources.dockerRegistry,
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

test('publish with semver-tag', async t => {
  const { runCi, gitHeadCommit } = await createRepo(t, {
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
          dockerOrganizationName: t.context.resources.quayNamespace,
          registry: t.context.resources.dockerRegistry,
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

test('publish with hash-tag', async t => {
  const { runCi } = await createRepo(t, {
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
          dockerOrganizationName: t.context.resources.quayNamespace,
          registry: t.context.resources.dockerRegistry,
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

test('publish with hash-tag and then with semver-tag', async t => {
  const { runCi, gitHeadCommit } = await createRepo(t, {
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
          dockerOrganizationName: t.context.resources.quayNamespace,
          registry: t.context.resources.dockerRegistry,
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

test('publish with hash-tag twice', async t => {
  const { runCi } = await createRepo(t, {
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
          dockerOrganizationName: t.context.resources.quayNamespace,
          registry: t.context.resources.dockerRegistry,
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

test('publish with semver-tag twice', async t => {
  const { runCi, gitHeadCommit } = await createRepo(t, {
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
          dockerOrganizationName: t.context.resources.quayNamespace,
          registry: t.context.resources.dockerRegistry,
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

test('artifact package-json name has @ symbol', async t => {
  const { runCi } = await createRepo(t, {
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
          dockerOrganizationName: t.context.resources.quayNamespace,
          registry: t.context.resources.dockerRegistry,
          imageInstallArtifactsFromNpmRegistry: true,
          buildAndPushOnlyTempVersion: true,
        }),
      ]),
    },
  })

  const { published, jsonReport } = await runCi()

  expect(published.get('@scope1/a1')?.docker.tags).toEqual([
    `artifact-hash-${jsonReport.artifacts[0].data.artifact.packageHash}`,
  ])
})
