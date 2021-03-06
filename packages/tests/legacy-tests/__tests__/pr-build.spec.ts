import { test, expect } from '@jest/globals'
import { newEnv } from './prepare-test'
import { TargetType } from './prepare-test/types'

const { createRepo } = newEnv()

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
      },
    },
  })
  expect(pr.passed).toBeTruthy()
  expect(pr.published).toHaveProperty('size', 0)
})
