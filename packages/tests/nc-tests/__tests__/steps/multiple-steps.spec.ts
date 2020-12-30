import { LogLevel } from '@tahini/core'
import { createTest } from '@tahini/e2e-tests-infra'
import { dockerPublish, installRoot, npmPublish, NpmScopeAccess, validatePackages } from '@tahini/steps'
import { createLinearStepsGraph } from '@tahini/steps-graph'
import { TargetType } from '@tahini/utils'

const { createRepo, getResources } = createTest()

it(`reproduce bug - flow hangs when there is a npm + docker publishes`, async () => {
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
          registry: getResources().dockerRegistry,
          buildAndPushOnlyTempVersion: false,
        }),
      ]),
    },
  })
  const { published, jsonReport } = await runCi()

  expect(published.get('a')?.npm.versions).toEqual(['1.0.0'])
  expect(published.get('b')?.docker.tags.sort()).toEqual(
    [`artifact-hash-${jsonReport.artifacts[1].data.artifact.packageHash}`, await gitHeadCommit()].sort(),
  )
})

it(`reproduce bug - steps are triggered in the wrong time when using waitUntilArtifactParentsFinishedParentSteps=false in one of the steps`, async () => {
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
        installRoot(),
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
