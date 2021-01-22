import { LogLevel } from '@era-ci/core'
import { createRepo, createTest, test } from '@era-ci/e2e-tests-infra'
import { dockerPublish, installRoot, npmPublish, NpmScopeAccess, validatePackages } from '@era-ci/steps'
import { createLinearStepsGraph } from '@era-ci/steps-graph'
import { TargetType } from '@era-ci/utils'
import expect from 'expect'

createTest(test)

test(`reproduce bug - flow hangs when there is a npm + docker publishes`, async t => {
  t.timeout(50 * 1000)

  const { runCi, gitHeadCommit } = await createRepo(t, {
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
          registry: t.context.resources.npmRegistry.address,
          publishAuth: t.context.resources.npmRegistry.auth,
        }),
        dockerPublish({
          isStepEnabled: true,
          dockerOrganizationName: t.context.resources.quayNamespace,
          registry: t.context.resources.dockerRegistry,
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

test(`reproduce bug - steps are triggered in the wrong time when using waitUntilArtifactParentsFinishedParentSteps=false in one of the steps`, async t => {
  t.timeout(50 * 1000)

  const { runCi } = await createRepo(t, {
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
          registry: t.context.resources.npmRegistry.address,
          publishAuth: t.context.resources.npmRegistry.auth,
        }),
      ]),
    },
  })
  const { published } = await runCi()

  expect(published.get('a')?.npm.versions).toEqual(['1.0.0'])
})
