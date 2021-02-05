import { createTest } from '@era-ci/e2e-tests-infra'
import { dockerPublish, npmPublish, NpmScopeAccess } from '@era-ci/steps'
import { createLinearStepsGraph } from '@era-ci/steps-graph'
import { localSequentalTaskQueue } from '@era-ci/task-queues'
import { ExecutionStatus, TargetType } from '@era-ci/utils'
import execa from 'execa'
import expect from 'expect'
import path from 'path'

const { createRepo, getResources } = createTest()

test.only('docker-artifact depends on published npm-artifact during docker-build', async () => {
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
          name: 'a',
          version: '1.0.0',
          additionalFiles: {
            Dockerfile: `\
            FROM quay.io/eraci/node:15.7.0-alpine3.10
            RUN NPM_USER=${username} NPM_PASS="${password}" NPM_EMAIL=${email} NPM_REGISTRY=${registryAddress} npx npm-login-noninteractive
            RUN npm view ${toActualName('b')}@2.0.0 --registry ${registryAddress}
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
          dockerRegistry: getResources().dockerRegistry,
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

test('publish -> modify repo without commiting -> try to publish again on the same git-head-commit - \
we expect that the build will fail because of not, the image-tag will be overrided in the docker-registry \
 and this is very bad and dangerous', async () => {
  const { runCi, gitHeadCommit, repoPath, toActualName } = await createRepo({
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          targetType: TargetType.docker,
          additionalFiles: {
            file1: 'a',
          },
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

  const result1 = await runCi()

  expect(result1.published.get('a')?.docker.tags).toEqual([await gitHeadCommit()])

  await execa.command(`echo bbbb > ${path.join(repoPath, 'packages', toActualName('a'), 'file1')}`, {
    shell: true,
    stdio: 'inherit',
  })

  const result2 = await runCi()

  expect(result2.passed).toBeFalsy()
  expect(
    result2.jsonReport.stepsResultOfArtifactsByArtifact[0].data.stepsResult[0].data.artifactStepResult.executionStatus,
  ).toEqual(ExecutionStatus.aborted)
  expect(result2.published.get('a')?.docker.tags).toEqual([await gitHeadCommit()])
  expect(result2.published.get('a')?.docker.tags).toEqual([await gitHeadCommit()])
})
