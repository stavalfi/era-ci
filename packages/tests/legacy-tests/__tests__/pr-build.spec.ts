import expect from 'expect'
import { newEnv, test } from './prepare-test'
import { TargetType } from './prepare-test/types'

const { createRepo } = newEnv(test)

test('1 package', async () => {
  const { runCi } = await createRepo({
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
