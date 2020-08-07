import { newEnv } from './prepare-test'
import { TargetType } from './prepare-test/types'

const { createRepo } = newEnv()

test('disable npm targets', async () => {
  const { runCi } = await createRepo({
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
  expect(master1.published.get('b')?.docker?.tags).toEqual(['2.0.0'])
})

test('disable docker targets', async () => {
  const { runCi } = await createRepo({
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
  expect(master1.published.get('b')?.docker?.tags).toEqual(['2.0.0'])
})
