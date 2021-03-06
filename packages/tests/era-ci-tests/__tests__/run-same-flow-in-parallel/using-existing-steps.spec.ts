import { createTest } from '@era-ci/e2e-tests-infra'
import { buildRoot, installRoot, npmPublish, NpmScopeAccess, quayDockerPublish } from '@era-ci/steps'
import { createLinearStepsGraph } from '@era-ci/steps-graph'
import { quayBuildsTaskQueue, taskWorkerTaskQueue } from '@era-ci/task-queues'
import { TargetType } from '@era-ci/utils'
import { expect, test } from '@jest/globals'
import chance from 'chance'
import _ from 'lodash'

const { createRepo, getResources } = createTest({ startQuayHelperService: true, startQuayMockService: true })

test('multiple packages, multiple steps', async () => {
  const { runCi } = await createRepo({
    repo: {
      packages: _.range(0, 5).map(i => ({
        name: `a${i}`,
        version: '1.0.0',
      })),
      rootPackageJson: {
        scripts: {
          build: 'echo "building... (doing nothing)"',
        },
      },
    },
    configurations: {
      taskQueues: [
        taskWorkerTaskQueue({
          queueName: `queue-${chance().hash().slice(0, 8)}`,
          redis: {
            url: getResources().redisServerUrl,
          },
        }),
      ],
      steps: createLinearStepsGraph([
        installRoot({ isStepEnabled: true }),
        buildRoot({
          isStepEnabled: true,
          scriptName: 'build',
        }),
        npmPublish({
          isStepEnabled: true,
          npmScopeAccess: NpmScopeAccess.public,
          registry: getResources().npmRegistry.address,
          registryAuth: getResources().npmRegistry.auth,
        }),
      ]),
    },
  })
  const flows = await Promise.all([runCi(), runCi(), runCi(), runCi(), runCi(), runCi()])

  for (const result of flows) {
    expect(result.passed).toBeTruthy()
  }
})

test('single package - run 2 flows at the same time on the same commit', async () => {
  const { runCi, gitHeadCommit, repoPath, repoName } = await createRepo({
    repo: {
      packages: [
        {
          name: 'a1',
          version: '1.0.0',
          targetType: TargetType.docker,
        },
      ],
    },
    configurations: {
      taskQueues: [
        quayBuildsTaskQueue({
          getCommitTarGzPublicAddress: async (): Promise<{ url: string; folderName: string }> => {
            return {
              url: `${
                getResources().quayHelperService.address
              }/download-git-repo-tar-gz?git_registry=local-filesystem&repo_abs_path=${repoPath}`,
              folderName: `${repoName}-${await gitHeadCommit()}`,
            }
          },
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
          dockerRegistry: getResources().dockerRegistry,
          quayService: getResources().quayMockService.address,
          imagesVisibility: 'public',
        }),
      ]),
    },
  })

  const head = await gitHeadCommit()
  const flows = await Promise.all([runCi(), runCi()])

  for (const result of flows) {
    expect(result.passed).toBeTruthy()
  }

  const repos = Object.values(getResources().quayMockService.db.namespaces[getResources().quayNamespace].repos)

  expect(flows.flatMap(f => f.published.get(`a1`)?.docker.tags)).toContainEqual(head)

  for (const repo of repos) {
    expect(Object.keys(repo.builds).length).toBeLessThanOrEqual(flows.length)
  }
})

test('multiple packages - run 2 flows at the same time on the same commit', async () => {
  const { runCi, gitHeadCommit, repoPath, repoName } = await createRepo({
    repo: {
      packages: _.range(0, 3).map(i => ({
        name: `a${i}`,
        version: '1.0.0',
        targetType: TargetType.docker,
      })),
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
          dockerRegistry: getResources().dockerRegistry,
          quayService: getResources().quayMockService.address,
          imagesVisibility: 'public',
        }),
      ]),
    },
  })

  const head = await gitHeadCommit()
  const flows = await Promise.all([runCi(), runCi()])

  for (const result of flows) {
    expect(result.passed).toBeTruthy()
  }

  const repos = Object.values(getResources().quayMockService.db.namespaces[getResources().quayNamespace].repos)

  for (const artifact of flows[0].jsonReport.artifacts) {
    expect(flows.flatMap(f => f.published.get(artifact.data.artifact.packageJson.name)?.docker.tags)).toContainEqual(
      head,
    )
  }

  for (const repo of repos) {
    expect(Object.keys(repo.builds).length).toBeLessThanOrEqual(flows.length)
  }
})
