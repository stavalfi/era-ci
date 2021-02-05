import { LogLevel } from '@era-ci/core'
import { createTest } from '@era-ci/e2e-tests-infra'
import { dockerPublish, installRoot, npmPublish, NpmScopeAccess, validatePackages } from '@era-ci/steps'
import { createLinearStepsGraph } from '@era-ci/steps-graph'
import { TargetType } from '@era-ci/utils'
import expect from 'expect'

const { createRepo, getResources } = createTest()

test(`reproduce bug - flow hangs when there is a npm + docker publishes`, async () => {
  const { runCi, gitHeadCommit } = await createRepo({
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
          dockerRegistry: getResources().dockerRegistry,
        }),
      ]),
    },
  })
  const { published } = await runCi()

  expect(published.get('a')?.npm.versions).toEqual(['1.0.0'])
  expect(published.get('b')?.docker.tags).toEqual([await gitHeadCommit()])
})

test(`reproduce bug - steps are triggered in the wrong time when using waitUntilArtifactParentsFinishedParentSteps=false in one of the steps`, async () => {
  const { runCi } = await createRepo({
    logLevel: LogLevel.debug,
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          targetType: TargetType.npm,
        },
      ],
    },
    configurations: {
      steps: createLinearStepsGraph([
        validatePackages(),
        installRoot({ isStepEnabled: true }),
        npmPublish({
          isStepEnabled: true,
          npmScopeAccess: NpmScopeAccess.public,
          registry: getResources().npmRegistry.address,
          publishAuth: getResources().npmRegistry.auth,
        }),
      ]),
    },
  })
  const { published } = await runCi()

  expect(published.get('a')?.npm.versions).toEqual(['1.0.0'])
})
