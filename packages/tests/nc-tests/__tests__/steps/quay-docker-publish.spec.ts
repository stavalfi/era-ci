import { createTest } from '@tahini/e2e-tests-infra'
import { quayDockerPublish } from '@tahini/steps'
import { createLinearStepsGraph } from '@tahini/steps-graph'
import { quayBuildsTaskQueue } from '@tahini/task-queues'

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
