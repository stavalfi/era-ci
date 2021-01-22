import expect from 'expect'
import { newEnv, test } from './prepare-test'
import { TargetType } from './prepare-test/types'

const { createRepo } = newEnv(test)

test('1 package', async t => {
  t.timeout(50 * 1000)

  const { runCi } = await createRepo(t, {
    packages: [
      {
        name: 'a',
        version: '1.0.0',
        targetType: TargetType.npm,
      },
    ],
  })
  const pr = await runCi({
    targetsInfo: {
      npm: {
        shouldPublish: false,
        shouldDeploy: false,
      },
    },
  })
  expect(pr.published).toHaveProperty('size', 0)
})
