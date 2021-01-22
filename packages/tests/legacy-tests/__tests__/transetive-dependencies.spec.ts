import expect from 'expect'
import { newEnv, test } from './prepare-test'
import { TargetType } from './prepare-test/types'

const { createRepo } = newEnv(test)

test('c depends on b which depends on a. if a changes, all need to run again everything', async t => {
  t.timeout(50 * 1000)

  const { runCi, addRandomFileToPackage } = await createRepo(t, {
    packages: [
      {
        name: 'c',
        version: '1.0.0',
        targetType: TargetType.npm,
        dependencies: {
          b: '^1.0.0',
        },
      },
      {
        name: 'b',
        version: '1.0.0',
        targetType: TargetType.npm,
        dependencies: {
          a: '^1.0.0',
        },
      },
      {
        name: 'a',
        version: '1.0.0',
        targetType: TargetType.npm,
      },
    ],
  })

  const master1 = await runCi({
    targetsInfo: {
      npm: {
        shouldPublish: true,
        shouldDeploy: false,
      },
    },
  })

  expect(master1.published.get('a')?.npm?.versions).toEqual(['1.0.0'])
  expect(master1.published.get('b')?.npm?.versions).toEqual(['1.0.0'])
  expect(master1.published.get('c')?.npm?.versions).toEqual(['1.0.0'])

  await addRandomFileToPackage('a')

  const master2 = await runCi({
    targetsInfo: {
      npm: {
        shouldPublish: true,
        shouldDeploy: false,
      },
    },
  })

  expect(master2.published.get('a')?.npm?.versions).toEqual(['1.0.0', '1.0.1'])
  expect(master2.published.get('b')?.npm?.versions).toEqual(['1.0.0', '1.0.1'])
  expect(master2.published.get('c')?.npm?.versions).toEqual(['1.0.0', '1.0.1'])
})
