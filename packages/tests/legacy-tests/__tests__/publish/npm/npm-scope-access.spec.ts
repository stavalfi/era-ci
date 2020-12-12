import { NpmScopeAccess } from '@tahini/steps'
import { newEnv } from '../../prepare-test'
import { TargetType } from '../../prepare-test/types'

const { createRepo } = newEnv()

test('npm package with scope.access=public', async () => {
  const { runCi } = await createRepo({
    packages: [
      {
        name: '@scope1/a',
        version: '1.0.0',
        targetType: TargetType.npm,
      },
    ],
  })

  const master = await runCi({
    targetsInfo: {
      npm: {
        shouldPublish: true,
        shouldDeploy: false,
        npmScopeAccess: NpmScopeAccess.public,
      },
    },
  })
  expect(master.published.get('@scope1/a')?.npm?.versions).toEqual(['1.0.0'])
})

test('npm package with scope.access=private', async () => {
  const { runCi } = await createRepo({
    packages: [
      {
        name: '@scope1/a',
        version: '1.0.0',
        targetType: TargetType.npm,
      },
    ],
  })

  const master = await runCi({
    targetsInfo: {
      npm: {
        shouldPublish: true,
        shouldDeploy: false,
        npmScopeAccess: NpmScopeAccess.restricted,
      },
    },
  })
  expect(master.published.get('@scope1/a')?.npm?.versions).toEqual(['1.0.0'])
})