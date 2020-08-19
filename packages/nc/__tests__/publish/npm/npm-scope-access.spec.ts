import { NpmScopeAccess } from '@tahini/nc'
import { newEnv } from '../../prepare-test'
import { TargetType } from '../../prepare-test/types'

const { createRepo } = newEnv()

test('npm package with scope.access=public', async () => {
  const { runCi } = await createRepo({
    packages: [
      {
        name: 'a',
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
  expect(master.published.get('a')?.npm?.versions).toEqual(['1.0.0'])
})

test('npm package with scope.access=private', async () => {
  const { runCi } = await createRepo({
    packages: [
      {
        name: 'a',
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
        npmScopeAccess: NpmScopeAccess.private,
      },
    },
  })
  expect(master.published.get('a')?.npm?.versions).toEqual(['1.0.0'])
})
