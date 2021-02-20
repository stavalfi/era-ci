import { createTest } from '@era-ci/e2e-tests-infra'
import { quayDockerPublish } from '@era-ci/steps'
import { createLinearStepsGraph } from '@era-ci/steps-graph'
import { quayBuildsTaskQueue } from '@era-ci/task-queues'
import { ExecutionStatus, Status, TargetType } from '@era-ci/utils'
import expect from 'expect'

const { getResources, createRepo } = createTest({
  startQuayHelperService: true,
  startQuayMockService: true,
})

test('single package - no problems - step should pass', async () => {
  const { runCi, gitHeadCommit, repoPath, repoName } = await createRepo({
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
          getCommitTarGzPublicAddress: async (): Promise<{ url: string; folderName: string }> => ({
            url: `${
              getResources().quayHelperService.address
            }/download-git-repo-tar-gz?git_registry=local-filesystem&repo_abs_path=${repoPath}`,
            folderName: `${repoName}-${await gitHeadCommit()}`,
          }),
          dockerRegistry: getResources().dockerRegistry,
          quayService: getResources().quayMockService.address,
          quayNamespace: getResources().quayNamespace,
          quayHelperServiceUrl: getResources().quayHelperService.address,
          quayToken: getResources().quayToken,
          redis: {
            url: getResources().redisServerUrl,
          },
        }),
      ],
      steps: createLinearStepsGraph([
        quayDockerPublish({
          isStepEnabled: true,
          dockerRegistry: getResources().dockerRegistry,
          quayService: getResources().quayMockService.address,
          dockerOrganizationName: getResources().quayNamespace,
          dockerfileBuildTimeoutMs: 100 * 1000,
          imagesVisibility: 'public',
        }),
      ]),
    },
  })

  const { passed, published } = await runCi()
  expect(passed).toBeTruthy()
  expect(published.get('a')?.docker.tags).toEqual([await gitHeadCommit()])
})

test('multiple packages - no problems - step should pass', async () => {
  const { runCi, gitHeadCommit, repoPath, repoName } = await createRepo({
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
          getCommitTarGzPublicAddress: async (): Promise<{ url: string; folderName: string }> => ({
            url: `${
              getResources().quayHelperService.address
            }/download-git-repo-tar-gz?git_registry=local-filesystem&repo_abs_path=${repoPath}`,
            folderName: `${repoName}-${await gitHeadCommit()}`,
          }),
          dockerRegistry: getResources().dockerRegistry,
          quayService: getResources().quayMockService.address,
          quayNamespace: getResources().quayNamespace,
          quayHelperServiceUrl: getResources().quayHelperService.address,
          quayToken: getResources().quayToken,
          redis: {
            url: getResources().redisServerUrl,
          },
        }),
      ],
      steps: createLinearStepsGraph([
        quayDockerPublish({
          isStepEnabled: true,
          dockerOrganizationName: getResources().quayNamespace,
          dockerfileBuildTimeoutMs: 100 * 1000,
          dockerRegistry: getResources().dockerRegistry,
          quayService: getResources().quayMockService.address,
          imagesVisibility: 'public',
        }),
      ]),
    },
  })

  const { passed, published } = await runCi()

  expect(passed).toBeTruthy()
  expect(published.get('a')?.docker.tags).toEqual([await gitHeadCommit()])
  expect(published.get('b')?.docker.tags).toEqual([await gitHeadCommit()])
})

// flaky - not sure why
test('expect the step to be failed if the Dockerfile has an error', async () => {
  const { runCi, repoPath, repoName, gitHeadCommit } = await createRepo({
    repo: {
      packages: [
        {
          name: 'a20',
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
          getCommitTarGzPublicAddress: async (): Promise<{ url: string; folderName: string }> => ({
            url: `${
              getResources().quayHelperService.address
            }/download-git-repo-tar-gz?git_registry=local-filesystem&repo_abs_path=${repoPath}`,
            folderName: `${repoName}-${await gitHeadCommit()}`,
          }),
          dockerRegistry: getResources().dockerRegistry,
          quayService: getResources().quayMockService.address,
          quayNamespace: getResources().quayNamespace,
          quayHelperServiceUrl: getResources().quayHelperService.address,
          quayToken: getResources().quayToken,
          redis: {
            url: getResources().redisServerUrl,
          },
        }),
      ],
      steps: createLinearStepsGraph([
        quayDockerPublish({
          isStepEnabled: true,
          dockerOrganizationName: getResources().quayNamespace,
          dockerfileBuildTimeoutMs: 100 * 1000,
          dockerRegistry: getResources().dockerRegistry,
          quayService: getResources().quayMockService.address,
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

test('run step again on failure and expect to fail again (no skip)', async () => {
  const { runCi, repoPath, repoName, gitHeadCommit } = await createRepo({
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
          getCommitTarGzPublicAddress: async (): Promise<{ url: string; folderName: string }> => ({
            url: `${
              getResources().quayHelperService.address
            }/download-git-repo-tar-gz?git_registry=local-filesystem&repo_abs_path=${repoPath}`,
            folderName: `${repoName}-${await gitHeadCommit()}`,
          }),
          dockerRegistry: getResources().dockerRegistry,
          quayService: getResources().quayMockService.address,
          quayNamespace: getResources().quayNamespace,
          quayHelperServiceUrl: getResources().quayHelperService.address,
          quayToken: getResources().quayToken,
          redis: {
            url: getResources().redisServerUrl,
          },
        }),
      ],
      steps: createLinearStepsGraph([
        quayDockerPublish({
          isStepEnabled: true,
          dockerOrganizationName: getResources().quayNamespace,
          dockerfileBuildTimeoutMs: 100 * 1000,
          dockerRegistry: getResources().dockerRegistry,
          quayService: getResources().quayMockService.address,
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
  const { runCi, repoPath, repoName, gitHeadCommit } = await createRepo({
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
          getCommitTarGzPublicAddress: async (): Promise<{ url: string; folderName: string }> => ({
            url: `${
              getResources().quayHelperService.address
            }/download-git-repo-tar-gz?git_registry=local-filesystem&repo_abs_path=${repoPath}`,
            folderName: `${repoName}-${await gitHeadCommit()}`,
          }),
          dockerRegistry: getResources().dockerRegistry,
          quayService: getResources().quayMockService.address,
          quayNamespace: getResources().quayNamespace,
          quayHelperServiceUrl: getResources().quayHelperService.address,
          quayToken: getResources().quayToken,
          redis: {
            url: getResources().redisServerUrl,
          },
        }),
      ],
      steps: createLinearStepsGraph([
        quayDockerPublish({
          isStepEnabled: true,
          dockerOrganizationName: getResources().quayNamespace,
          dockerfileBuildTimeoutMs: 100 * 1000,
          dockerRegistry: getResources().dockerRegistry,
          quayService: getResources().quayMockService.address,
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

test('publish with final-tag', async () => {
  const { runCi, gitHeadCommit, repoPath, repoName } = await createRepo({
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
          getCommitTarGzPublicAddress: async (): Promise<{ url: string; folderName: string }> => ({
            url: `${
              getResources().quayHelperService.address
            }/download-git-repo-tar-gz?git_registry=local-filesystem&repo_abs_path=${repoPath}`,
            folderName: `${repoName}-${await gitHeadCommit()}`,
          }),
          dockerRegistry: getResources().dockerRegistry,
          quayService: getResources().quayMockService.address,
          quayNamespace: getResources().quayNamespace,
          quayHelperServiceUrl: getResources().quayHelperService.address,
          quayToken: getResources().quayToken,
          redis: {
            url: getResources().redisServerUrl,
          },
        }),
      ],
      steps: createLinearStepsGraph([
        quayDockerPublish({
          isStepEnabled: true,
          dockerOrganizationName: getResources().quayNamespace,
          dockerfileBuildTimeoutMs: 100 * 1000,
          dockerRegistry: getResources().dockerRegistry,
          quayService: getResources().quayMockService.address,
          imagesVisibility: 'public',
        }),
      ]),
    },
  })

  const { published } = await runCi()

  expect(published.get('a')?.docker.tags).toEqual([await gitHeadCommit()])
})

test('publish with final-tag twice', async () => {
  const { runCi, gitHeadCommit, repoPath, repoName } = await createRepo({
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
          getCommitTarGzPublicAddress: async (): Promise<{ url: string; folderName: string }> => ({
            url: `${
              getResources().quayHelperService.address
            }/download-git-repo-tar-gz?git_registry=local-filesystem&repo_abs_path=${repoPath}`,
            folderName: `${repoName}-${await gitHeadCommit()}`,
          }),
          dockerRegistry: getResources().dockerRegistry,
          quayService: getResources().quayMockService.address,
          quayNamespace: getResources().quayNamespace,
          quayHelperServiceUrl: getResources().quayHelperService.address,
          quayToken: getResources().quayToken,
          redis: {
            url: getResources().redisServerUrl,
          },
        }),
      ],
      steps: createLinearStepsGraph([
        quayDockerPublish({
          isStepEnabled: true,
          dockerOrganizationName: getResources().quayNamespace,
          dockerfileBuildTimeoutMs: 100 * 1000,
          dockerRegistry: getResources().dockerRegistry,
          quayService: getResources().quayMockService.address,
          imagesVisibility: 'public',
        }),
      ]),
    },
  })

  await runCi()

  const { published } = await runCi()

  expect(published.get('a')?.docker.tags).toEqual([await gitHeadCommit()])
})

test('artifact package-json name has @ symbol', async () => {
  const { runCi, gitHeadCommit, repoPath, repoName } = await createRepo({
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
      taskQueues: [
        quayBuildsTaskQueue({
          getCommitTarGzPublicAddress: async (): Promise<{ url: string; folderName: string }> => ({
            url: `${
              getResources().quayHelperService.address
            }/download-git-repo-tar-gz?git_registry=local-filesystem&repo_abs_path=${repoPath}`,
            folderName: `${repoName}-${await gitHeadCommit()}`,
          }),
          dockerRegistry: getResources().dockerRegistry,
          quayService: getResources().quayMockService.address,
          quayNamespace: getResources().quayNamespace,
          quayHelperServiceUrl: getResources().quayHelperService.address,
          quayToken: getResources().quayToken,
          redis: {
            url: getResources().redisServerUrl,
          },
        }),
      ],
      steps: createLinearStepsGraph([
        quayDockerPublish({
          isStepEnabled: true,
          dockerOrganizationName: getResources().quayNamespace,
          dockerfileBuildTimeoutMs: 100 * 1000,
          dockerRegistry: getResources().dockerRegistry,
          quayService: getResources().quayMockService.address,
          imagesVisibility: 'public',
        }),
      ]),
    },
  })

  const { published } = await runCi()

  expect(published.get('@scope1/a1')?.docker.tags).toEqual([await gitHeadCommit()])
})
