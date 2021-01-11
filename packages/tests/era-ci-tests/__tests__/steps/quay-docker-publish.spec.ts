import { createRepo, createTest, test } from '@era-ci/e2e-tests-infra'
import { quayDockerPublish } from '@era-ci/steps'
import { createLinearStepsGraph } from '@era-ci/steps-graph'
import { quayBuildsTaskQueue } from '@era-ci/task-queues'
import { ExecutionStatus, Status, TargetType } from '@era-ci/utils'
import expect from 'expect'

createTest(test)

test('single package - no problems - step should pass', async t => {
  const { runCi, gitHeadCommit, repoPath } = await createRepo(t, {
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          additionalFiles: {
            Dockerfile: `\
          FROM alpine
          CMD ["echo","hello"]
          `,
          },
        },
      ],
    },
    configurations: {
      taskQueues: [
        quayBuildsTaskQueue({
          getCommitTarGzPublicAddress: (): string =>
            `${t.context.resources.quayHelperService.address}/download-git-repo-tar-gz?git_registry=local-filesystem&repo_abs_path=${repoPath}`,
          quayAddress: t.context.resources.quayMockService.address,
          quayNamespace: t.context.resources.quayNamespace,
          quayServiceHelperAddress: t.context.resources.quayHelperService.address,
          quayToken: t.context.resources.quayToken,
          redis: {
            url: t.context.resources.redisServerUrl,
          },
        }),
      ],
      steps: createLinearStepsGraph([
        quayDockerPublish({
          isStepEnabled: true,
          dockerOrganizationName: t.context.resources.quayNamespace,
          dockerfileBuildTimeoutMs: 100 * 1000,
          registry: t.context.resources.dockerRegistry,
          imagesVisibility: 'public',
          buildAndPushOnlyTempVersion: false,
        }),
      ]),
    },
  })

  const { passed, published, jsonReport } = await runCi()
  expect(passed).toBeTruthy()
  expect(published.get('a')?.docker.tags.sort()).toEqual(
    [`artifact-hash-${jsonReport.artifacts[0].data.artifact.packageHash}`, await gitHeadCommit()].sort(),
  )
})

test('multiple packages - no problems - step should pass', async t => {
  const { runCi, gitHeadCommit, repoPath } = await createRepo(t, {
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          additionalFiles: {
            Dockerfile: `\
          FROM alpine
          CMD ["echo","hello"]
          `,
          },
        },
        {
          name: 'b',
          version: '1.0.1',
          additionalFiles: {
            Dockerfile: `\
          FROM alpine
          CMD ["echo","hello"]
          `,
          },
        },
      ],
    },
    configurations: {
      taskQueues: [
        quayBuildsTaskQueue({
          getCommitTarGzPublicAddress: (): string =>
            `${t.context.resources.quayHelperService.address}/download-git-repo-tar-gz?git_registry=local-filesystem&repo_abs_path=${repoPath}`,
          quayAddress: t.context.resources.quayMockService.address,
          quayNamespace: t.context.resources.quayNamespace,
          quayServiceHelperAddress: t.context.resources.quayHelperService.address,
          quayToken: t.context.resources.quayToken,
          redis: {
            url: t.context.resources.redisServerUrl,
          },
        }),
      ],
      steps: createLinearStepsGraph([
        quayDockerPublish({
          isStepEnabled: true,
          dockerOrganizationName: t.context.resources.quayNamespace,
          dockerfileBuildTimeoutMs: 100 * 1000,
          registry: t.context.resources.dockerRegistry,
          imagesVisibility: 'public',
          buildAndPushOnlyTempVersion: false,
        }),
      ]),
    },
  })

  const { passed, published, jsonReport } = await runCi()

  expect(passed).toBeTruthy()
  expect(published.get('a')?.docker.tags.sort()).toEqual(
    [`artifact-hash-${jsonReport.artifacts[0].data.artifact.packageHash}`, await gitHeadCommit()].sort(),
  )
  expect(published.get('b')?.docker.tags.sort()).toEqual(
    [`artifact-hash-${jsonReport.artifacts[1].data.artifact.packageHash}`, await gitHeadCommit()].sort(),
  )
})

test('expect the step to be failed if the dockerfile has an error', async t => {
  const { runCi, repoPath } = await createRepo(t, {
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          additionalFiles: {
            Dockerfile: `\
          FROM alpine
          RUN exit 1
          `,
          },
        },
      ],
    },
    configurations: {
      taskQueues: [
        quayBuildsTaskQueue({
          getCommitTarGzPublicAddress: (): string =>
            `${t.context.resources.quayHelperService.address}/download-git-repo-tar-gz?git_registry=local-filesystem&repo_abs_path=${repoPath}`,
          quayAddress: t.context.resources.quayMockService.address,
          quayNamespace: t.context.resources.quayNamespace,
          quayServiceHelperAddress: t.context.resources.quayHelperService.address,
          quayToken: t.context.resources.quayToken,
          redis: {
            url: t.context.resources.redisServerUrl,
          },
        }),
      ],
      steps: createLinearStepsGraph([
        quayDockerPublish({
          isStepEnabled: true,
          dockerOrganizationName: t.context.resources.quayNamespace,
          dockerfileBuildTimeoutMs: 100 * 1000,
          registry: t.context.resources.dockerRegistry,
          imagesVisibility: 'public',
          buildAndPushOnlyTempVersion: false,
        }),
      ]),
    },
  })

  const result1 = await runCi()

  const artifactStepResult1 = result1.jsonReport.stepsResultOfArtifactsByArtifact[0].data.stepsResult[0].data
  expect(artifactStepResult1.artifactStepResult.executionStatus).toEqual(ExecutionStatus.done)
  if (artifactStepResult1.artifactStepResult.executionStatus === ExecutionStatus.done) {
    expect(artifactStepResult1.artifactStepResult.status).toEqual(Status.failed)
  }
})

test('run step again on failure and expect to abort-as-failed on second run', async t => {
  const { runCi, repoPath } = await createRepo(t, {
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          additionalFiles: {
            Dockerfile: `\
          FROM alpine
          RUN exit 1
          `,
          },
        },
      ],
    },
    configurations: {
      taskQueues: [
        quayBuildsTaskQueue({
          getCommitTarGzPublicAddress: (): string =>
            `${t.context.resources.quayHelperService.address}/download-git-repo-tar-gz?git_registry=local-filesystem&repo_abs_path=${repoPath}`,
          quayAddress: t.context.resources.quayMockService.address,
          quayNamespace: t.context.resources.quayNamespace,
          quayServiceHelperAddress: t.context.resources.quayHelperService.address,
          quayToken: t.context.resources.quayToken,
          redis: {
            url: t.context.resources.redisServerUrl,
          },
        }),
      ],
      steps: createLinearStepsGraph([
        quayDockerPublish({
          isStepEnabled: true,
          dockerOrganizationName: t.context.resources.quayNamespace,
          dockerfileBuildTimeoutMs: 100 * 1000,
          registry: t.context.resources.dockerRegistry,
          imagesVisibility: 'public',
          buildAndPushOnlyTempVersion: false,
        }),
      ]),
    },
  })

  await runCi()

  const result2 = await runCi()

  const artifactStepResult2 = result2.jsonReport.stepsResultOfArtifactsByArtifact[0].data.stepsResult[0].data
  expect(artifactStepResult2.artifactStepResult.executionStatus).toEqual(ExecutionStatus.done)
  if (artifactStepResult2.artifactStepResult.executionStatus === ExecutionStatus.done) {
    expect(artifactStepResult2.artifactStepResult.status).toEqual(Status.failed)
  }
})

test('do not run step again if step succeed (image built and pushed to registry)', async t => {
  const { runCi, repoPath } = await createRepo(t, {
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          additionalFiles: {
            Dockerfile: `\
          FROM alpine
          RUN echo hi
          `,
          },
        },
      ],
    },
    configurations: {
      taskQueues: [
        quayBuildsTaskQueue({
          getCommitTarGzPublicAddress: (): string =>
            `${t.context.resources.quayHelperService.address}/download-git-repo-tar-gz?git_registry=local-filesystem&repo_abs_path=${repoPath}`,
          quayAddress: t.context.resources.quayMockService.address,
          quayNamespace: t.context.resources.quayNamespace,
          quayServiceHelperAddress: t.context.resources.quayHelperService.address,
          quayToken: t.context.resources.quayToken,
          redis: {
            url: t.context.resources.redisServerUrl,
          },
        }),
      ],
      steps: createLinearStepsGraph([
        quayDockerPublish({
          isStepEnabled: true,
          dockerOrganizationName: t.context.resources.quayNamespace,
          dockerfileBuildTimeoutMs: 100 * 1000,
          registry: t.context.resources.dockerRegistry,
          imagesVisibility: 'public',
          buildAndPushOnlyTempVersion: false,
        }),
      ]),
    },
  })

  await runCi()

  const result2 = await runCi()

  const artifactStepResult2 = result2.jsonReport.stepsResultOfArtifactsByArtifact[0].data.stepsResult[0].data
  expect(artifactStepResult2.artifactStepResult.executionStatus).toEqual(ExecutionStatus.aborted)
  if (artifactStepResult2.artifactStepResult.executionStatus === ExecutionStatus.aborted) {
    expect(artifactStepResult2.artifactStepResult.status).toEqual(Status.skippedAsPassed)
  }
})

test.only('publish with semver-tag', async t => {
  const { runCi, gitHeadCommit, repoPath } = await createRepo(t, {
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
      taskQueues: [
        quayBuildsTaskQueue({
          getCommitTarGzPublicAddress: (): string =>
            `${t.context.resources.quayHelperService.address}/download-git-repo-tar-gz?git_registry=local-filesystem&repo_abs_path=${repoPath}`,
          quayAddress: t.context.resources.quayMockService.address,
          quayNamespace: t.context.resources.quayNamespace,
          quayServiceHelperAddress: t.context.resources.quayHelperService.address,
          quayToken: t.context.resources.quayToken,
          redis: {
            url: t.context.resources.redisServerUrl,
          },
        }),
      ],
      steps: createLinearStepsGraph([
        quayDockerPublish({
          isStepEnabled: true,
          dockerOrganizationName: t.context.resources.quayNamespace,
          dockerfileBuildTimeoutMs: 100 * 1000,
          registry: t.context.resources.dockerRegistry,
          imagesVisibility: 'public',
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
  const { runCi, repoPath } = await createRepo(t, {
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
      taskQueues: [
        quayBuildsTaskQueue({
          getCommitTarGzPublicAddress: (): string =>
            `${t.context.resources.quayHelperService.address}/download-git-repo-tar-gz?git_registry=local-filesystem&repo_abs_path=${repoPath}`,
          quayAddress: t.context.resources.quayMockService.address,
          quayNamespace: t.context.resources.quayNamespace,
          quayServiceHelperAddress: t.context.resources.quayHelperService.address,
          quayToken: t.context.resources.quayToken,
          redis: {
            url: t.context.resources.redisServerUrl,
          },
        }),
      ],
      steps: createLinearStepsGraph([
        quayDockerPublish({
          isStepEnabled: true,
          dockerOrganizationName: t.context.resources.quayNamespace,
          dockerfileBuildTimeoutMs: 100 * 1000,
          registry: t.context.resources.dockerRegistry,
          imagesVisibility: 'public',
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
  const { runCi, gitHeadCommit, repoPath } = await createRepo(t, {
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
      taskQueues: [
        quayBuildsTaskQueue({
          getCommitTarGzPublicAddress: (): string =>
            `${t.context.resources.quayHelperService.address}/download-git-repo-tar-gz?git_registry=local-filesystem&repo_abs_path=${repoPath}`,
          quayAddress: t.context.resources.quayMockService.address,
          quayNamespace: t.context.resources.quayNamespace,
          quayServiceHelperAddress: t.context.resources.quayHelperService.address,
          quayToken: t.context.resources.quayToken,
          redis: {
            url: t.context.resources.redisServerUrl,
          },
        }),
      ],
      steps: createLinearStepsGraph([
        quayDockerPublish({
          isStepEnabled: true,
          dockerOrganizationName: t.context.resources.quayNamespace,
          dockerfileBuildTimeoutMs: 100 * 1000,
          registry: t.context.resources.dockerRegistry,
          imagesVisibility: 'public',
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
  const { runCi, repoPath } = await createRepo(t, {
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
      taskQueues: [
        quayBuildsTaskQueue({
          getCommitTarGzPublicAddress: (): string =>
            `${t.context.resources.quayHelperService.address}/download-git-repo-tar-gz?git_registry=local-filesystem&repo_abs_path=${repoPath}`,
          quayAddress: t.context.resources.quayMockService.address,
          quayNamespace: t.context.resources.quayNamespace,
          quayServiceHelperAddress: t.context.resources.quayHelperService.address,
          quayToken: t.context.resources.quayToken,
          redis: {
            url: t.context.resources.redisServerUrl,
          },
        }),
      ],
      steps: createLinearStepsGraph([
        quayDockerPublish({
          isStepEnabled: true,
          dockerOrganizationName: t.context.resources.quayNamespace,
          dockerfileBuildTimeoutMs: 100 * 1000,
          registry: t.context.resources.dockerRegistry,
          imagesVisibility: 'public',
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
  const { runCi, gitHeadCommit, repoPath } = await createRepo(t, {
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
      taskQueues: [
        quayBuildsTaskQueue({
          getCommitTarGzPublicAddress: (): string =>
            `${t.context.resources.quayHelperService.address}/download-git-repo-tar-gz?git_registry=local-filesystem&repo_abs_path=${repoPath}`,
          quayAddress: t.context.resources.quayMockService.address,
          quayNamespace: t.context.resources.quayNamespace,
          quayServiceHelperAddress: t.context.resources.quayHelperService.address,
          quayToken: t.context.resources.quayToken,
          redis: {
            url: t.context.resources.redisServerUrl,
          },
        }),
      ],
      steps: createLinearStepsGraph([
        quayDockerPublish({
          isStepEnabled: true,
          dockerOrganizationName: t.context.resources.quayNamespace,
          dockerfileBuildTimeoutMs: 100 * 1000,
          registry: t.context.resources.dockerRegistry,
          imagesVisibility: 'public',
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
