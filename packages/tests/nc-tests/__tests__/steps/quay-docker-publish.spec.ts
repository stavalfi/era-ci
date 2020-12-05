import { createTest } from '@tahini/e2e-tests-infra'
import { quayDockerPublish } from '@tahini/steps'
import { createLinearStepsGraph } from '@tahini/steps-graph'
import { quayBuildsTaskQueue } from '@tahini/task-queues'
import { ExecutionStatus, Status } from '@tahini/utils'

const { createRepo, getResoureces } = createTest()

test('single package - no problems - step should pass', async () => {
  const { runCi, repoPath, getImageTags } = await createRepo({
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
              getResoureces().quayHelperService
            }/download-git-repo-tar-gz?git_registry=local-filesystem&repo_abs_path=${repoPath}`,
          quayAddress: getResoureces().quayMockService,
          quayNamespace: getResoureces().quayNamespace,
          quayServiceHelperAddress: getResoureces().quayHelperService,
          quayToken: getResoureces().quayToken,
          redisAddress: getResoureces().redisServerUri,
        }),
      ],
      steps: createLinearStepsGraph([
        quayDockerPublish({
          isStepEnabled: true,
          dockerOrganizationName: getResoureces().quayNamespace,
          dockerfileBuildTimeoutMs: 100 * 1000,
          registry: getResoureces().dockerRegistry,
          imagesVisibility: 'public',
        }),
      ]),
    },
  })

  const { passed } = await runCi()
  expect(passed).toBeTruthy()
  await expect(getImageTags('a')).resolves.toEqual(['1.0.0'])
})

test('multiple packages - no problems - step should pass', async () => {
  const { runCi, repoPath, getImageTags } = await createRepo({
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
              getResoureces().quayHelperService
            }/download-git-repo-tar-gz?git_registry=local-filesystem&repo_abs_path=${repoPath}`,
          quayAddress: getResoureces().quayMockService,
          quayNamespace: getResoureces().quayNamespace,
          quayServiceHelperAddress: getResoureces().quayHelperService,
          quayToken: getResoureces().quayToken,
          redisAddress: getResoureces().redisServerUri,
        }),
      ],
      steps: createLinearStepsGraph([
        quayDockerPublish({
          isStepEnabled: true,
          dockerOrganizationName: getResoureces().quayNamespace,
          dockerfileBuildTimeoutMs: 100 * 1000,
          registry: getResoureces().dockerRegistry,
          imagesVisibility: 'public',
        }),
      ]),
    },
  })

  const { passed } = await runCi()

  expect(passed).toBeTruthy()
  await expect(getImageTags('a')).resolves.toEqual(['1.0.0'])
  await expect(getImageTags('b')).resolves.toEqual(['1.0.1'])
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
              getResoureces().quayHelperService
            }/download-git-repo-tar-gz?git_registry=local-filesystem&repo_abs_path=${repoPath}`,
          quayAddress: getResoureces().quayMockService,
          quayNamespace: getResoureces().quayNamespace,
          quayServiceHelperAddress: getResoureces().quayHelperService,
          quayToken: getResoureces().quayToken,
          redisAddress: getResoureces().redisServerUri,
        }),
      ],
      steps: createLinearStepsGraph([
        quayDockerPublish({
          isStepEnabled: true,
          dockerOrganizationName: getResoureces().quayNamespace,
          dockerfileBuildTimeoutMs: 100 * 1000,
          registry: getResoureces().dockerRegistry,
          imagesVisibility: 'public',
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
              getResoureces().quayHelperService
            }/download-git-repo-tar-gz?git_registry=local-filesystem&repo_abs_path=${repoPath}`,
          quayAddress: getResoureces().quayMockService,
          quayNamespace: getResoureces().quayNamespace,
          quayServiceHelperAddress: getResoureces().quayHelperService,
          quayToken: getResoureces().quayToken,
          redisAddress: getResoureces().redisServerUri,
        }),
      ],
      steps: createLinearStepsGraph([
        quayDockerPublish({
          isStepEnabled: true,
          dockerOrganizationName: getResoureces().quayNamespace,
          dockerfileBuildTimeoutMs: 100 * 1000,
          registry: getResoureces().dockerRegistry,
          imagesVisibility: 'public',
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
              getResoureces().quayHelperService
            }/download-git-repo-tar-gz?git_registry=local-filesystem&repo_abs_path=${repoPath}`,
          quayAddress: getResoureces().quayMockService,
          quayNamespace: getResoureces().quayNamespace,
          quayServiceHelperAddress: getResoureces().quayHelperService,
          quayToken: getResoureces().quayToken,
          redisAddress: getResoureces().redisServerUri,
        }),
      ],
      steps: createLinearStepsGraph([
        quayDockerPublish({
          isStepEnabled: true,
          dockerOrganizationName: getResoureces().quayNamespace,
          dockerfileBuildTimeoutMs: 100 * 1000,
          registry: getResoureces().dockerRegistry,
          imagesVisibility: 'public',
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
