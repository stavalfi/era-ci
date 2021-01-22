import expect from 'expect'
import { newEnv, test } from './prepare-test'

const { createRepo } = newEnv(test)

test('empty repo', async t => {
  t.timeout(50 * 1000)

  const { runCi } = await createRepo(t)
  const pr = await runCi()
  expect(pr.published).toHaveProperty('size', 0)
  const master = await runCi({
    targetsInfo: {
      npm: {
        shouldPublish: true,
        shouldDeploy: false,
      },
      docker: {
        shouldPublish: true,
        shouldDeploy: false,
      },
    },
  })
  expect(master.published).toHaveProperty('size', 0)
})

test('artifacts without targets', async t => {
  t.timeout(50 * 1000)

  const { runCi } = await createRepo(t, {
    packages: [
      {
        name: 'a',
        version: '1.0.0',
      },
    ],
  })
  const pr = await runCi()
  expect(pr.published).toHaveProperty('size', 0)
  const master = await runCi({
    targetsInfo: {
      npm: {
        shouldPublish: true,
        shouldDeploy: false,
      },
      docker: {
        shouldPublish: true,
        shouldDeploy: false,
      },
    },
  })
  expect(master.published).toHaveProperty('size', 0)
})
