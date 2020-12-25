import { createTest } from '@tahini/e2e-tests-infra'
import { dockerPublish, npmPublish, NpmScopeAccess } from '@tahini/steps'
import { createLinearStepsGraph } from '@tahini/steps-graph'
import { localSequentalTaskQueue } from '@tahini/task-queues'
import { TargetType } from '@tahini/utils'

const { createRepo, getResources } = createTest()

test('docker-artifact depends on published npm-artifact during docker-build', async () => {
  const { runCi } = await createRepo(toActualName => ({
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
          doesImageContainsNpmArtifacts: true,
        }),
      ]),
    },
  }))

  const { passed, published } = await runCi()
  expect(passed).toBeTruthy()
  expect(published.get('a')?.docker.tags).toEqual(['1.0.0'])
  expect(published.get('b')?.npm.versions).toEqual(['2.0.0'])
})
