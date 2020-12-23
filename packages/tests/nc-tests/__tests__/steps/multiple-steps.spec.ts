import { createTest } from '@tahini/e2e-tests-infra'
import { npmPublish, NpmScopeAccess, dockerPublish } from '@tahini/steps'
import { createLinearStepsGraph } from '@tahini/steps-graph'
import { TargetType } from '@tahini/utils'

const { createRepo, getResources } = createTest()

it(`reproduce bug - flow hangs when there is a npm + docker publishes`, async () => {
  const { runCi } = await createRepo({
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          targetType: TargetType.npm,
        },
        {
          name: 'b',
          version: '2.0.0',
          targetType: TargetType.docker,
        },
      ],
    },
    configurations: {
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
        }),
      ]),
    },
  })
  const { published } = await runCi()

  expect(published.get('a')?.npm.versions).toEqual(['1.0.0'])
  expect(published.get('b')?.docker.tags).toEqual(['2.0.0'])
})
