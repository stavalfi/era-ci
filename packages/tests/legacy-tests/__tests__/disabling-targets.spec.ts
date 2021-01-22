import expect from 'expect'
import { newEnv, test } from './prepare-test'
import { TargetType } from './prepare-test/types'

const { createRepo } = newEnv(test)

test('disable npm targets', async t => {
  t.timeout(50 * 1000)

  const { runCi, gitHeadCommit } = await createRepo(t, {
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
  })

  const master1 = await runCi({
    targetsInfo: {
      docker: {
        shouldPublish: true,
        shouldDeploy: false,
      },
    },
  })
  expect(master1.published.get('a')?.npm?.versions).toBeFalsy()
  expect(master1.published.get('b')?.docker?.tags).toEqual(expect.arrayContaining([await gitHeadCommit()]))
})

test('disable docker targets', async t => {
  t.timeout(50 * 1000)

  const { runCi, gitHeadCommit } = await createRepo(t, {
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
  })

  const master1 = await runCi({
    targetsInfo: {
      docker: {
        shouldPublish: true,
        shouldDeploy: false,
      },
    },
  })
  expect(master1.published.get('a')?.npm?.versions).toBeFalsy()
  expect(master1.published.get('b')?.docker?.tags).toEqual(expect.arrayContaining([await gitHeadCommit()]))
})
