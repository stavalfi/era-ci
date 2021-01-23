import expect from 'expect'
import { newEnv } from './prepare-test'

const { createRepo } = newEnv()

test('empty repo', async () => {
  const { runCi } = await createRepo()
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

test('artifacts without targets', async () => {
  const { runCi } = await createRepo({
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
