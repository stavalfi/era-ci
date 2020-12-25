import { createTest } from '@tahini/e2e-tests-infra'
import { quayDockerPublish } from '@tahini/steps'
import { createLinearStepsGraph } from '@tahini/steps-graph'
import { quayBuildsTaskQueue } from '@tahini/task-queues'
import { ExecutionStatus, Status } from '@tahini/utils'

const { createRepo, getResources } = createTest()

test('single package - no problems - step should pass', async () => {
  const { runCi, repoPath } = await createRepo({
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
            `${
              getResources().quayHelperService
            }/download-git-repo-tar-gz?git_registry=local-filesystem&repo_abs_path=${repoPath}`,
          quayAddress: getResources().quayMockService,
          quayNamespace: getResources().quayNamespace,
          quayServiceHelperAddress: getResources().quayHelperService,
          quayToken: getResources().quayToken,
          redisAddress: getResources().redisServerUri,
        }),
      ],
      steps: createLinearStepsGraph([
        quayDockerPublish({
          isStepEnabled: true,
          dockerOrganizationName: getResources().quayNamespace,
          dockerfileBuildTimeoutMs: 100 * 1000,
          registry: getResources().dockerRegistry,
          imagesVisibility: 'public',
          buildAndPushOnlyTempVersion: false,
        }),
      ]),
    },
  })

  const { passed, published } = await runCi()
  expect(passed).toBeTruthy()
  expect(published.get('a')?.docker.tags).toEqual(['1.0.0'])
})

test('multiple packages - no problems - step should pass', async () => {
  const { runCi, repoPath } = await createRepo({
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
            `${
              getResources().quayHelperService
            }/download-git-repo-tar-gz?git_registry=local-filesystem&repo_abs_path=${repoPath}`,
          quayAddress: getResources().quayMockService,
          quayNamespace: getResources().quayNamespace,
          quayServiceHelperAddress: getResources().quayHelperService,
          quayToken: getResources().quayToken,
          redisAddress: getResources().redisServerUri,
        }),
      ],
      steps: createLinearStepsGraph([
        quayDockerPublish({
          isStepEnabled: true,
          dockerOrganizationName: getResources().quayNamespace,
          dockerfileBuildTimeoutMs: 100 * 1000,
          registry: getResources().dockerRegistry,
          imagesVisibility: 'public',
          buildAndPushOnlyTempVersion: false,
        }),
      ]),
    },
  })

  const { passed, published } = await runCi()

  expect(passed).toBeTruthy()
  expect(published.get('a')?.docker.tags).toEqual(['1.0.0'])
  expect(published.get('b')?.docker.tags).toEqual(['1.0.1'])
})

test('expect the step to be failed if the dockerfile has an error', async () => {
  const { runCi, repoPath } = await createRepo({
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
            `${
              getResources().quayHelperService
            }/download-git-repo-tar-gz?git_registry=local-filesystem&repo_abs_path=${repoPath}`,
          quayAddress: getResources().quayMockService,
          quayNamespace: getResources().quayNamespace,
          quayServiceHelperAddress: getResources().quayHelperService,
          quayToken: getResources().quayToken,
          redisAddress: getResources().redisServerUri,
        }),
      ],
      steps: createLinearStepsGraph([
        quayDockerPublish({
          isStepEnabled: true,
          dockerOrganizationName: getResources().quayNamespace,
          dockerfileBuildTimeoutMs: 100 * 1000,
          registry: getResources().dockerRegistry,
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

test('run step again on failure', async () => {
  const { runCi, repoPath } = await createRepo({
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
            `${
              getResources().quayHelperService
            }/download-git-repo-tar-gz?git_registry=local-filesystem&repo_abs_path=${repoPath}`,
          quayAddress: getResources().quayMockService,
          quayNamespace: getResources().quayNamespace,
          quayServiceHelperAddress: getResources().quayHelperService,
          quayToken: getResources().quayToken,
          redisAddress: getResources().redisServerUri,
        }),
      ],
      steps: createLinearStepsGraph([
        quayDockerPublish({
          isStepEnabled: true,
          dockerOrganizationName: getResources().quayNamespace,
          dockerfileBuildTimeoutMs: 100 * 1000,
          registry: getResources().dockerRegistry,
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

test('do not run step again if step succeed (image built and pushed to registry)', async () => {
  const { runCi, repoPath } = await createRepo({
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
            `${
              getResources().quayHelperService
            }/download-git-repo-tar-gz?git_registry=local-filesystem&repo_abs_path=${repoPath}`,
          quayAddress: getResources().quayMockService,
          quayNamespace: getResources().quayNamespace,
          quayServiceHelperAddress: getResources().quayHelperService,
          quayToken: getResources().quayToken,
          redisAddress: getResources().redisServerUri,
        }),
      ],
      steps: createLinearStepsGraph([
        quayDockerPublish({
          isStepEnabled: true,
          dockerOrganizationName: getResources().quayNamespace,
          dockerfileBuildTimeoutMs: 100 * 1000,
          registry: getResources().dockerRegistry,
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
