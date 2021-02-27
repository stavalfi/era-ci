import { test, expect } from '@jest/globals'
import { newEnv } from '../prepare-test'
import { TargetType } from '../prepare-test/types'

const { createRepo } = newEnv()

test(`there is no addtional publish of other packages if a package was deleted`, async () => {
  const { runCi, deletePackage } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
        targetType: TargetType.npm,
      },
      {
        name: 'b',
        version: '2.0.0',
        targetType: TargetType.npm,
      },
    ],
  })

  await runCi({
    targetsInfo: {
      npm: {
        shouldPublish: true,
      },
    },
  })

  await deletePackage('a')

  const master2 = await runCi({
    targetsInfo: {
      npm: {
        shouldPublish: true,
      },
    },
  })

  expect(master2.published.get('b')?.npm?.versions).toEqual(['2.0.0'])
})

test(`there is no addtional publish of other packages if addtional package was created (because yarn.lock will be modified)`, async () => {
  const { runCi, createNewPackage } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
        targetType: TargetType.npm,
      },
    ],
  })

  await runCi({
    targetsInfo: {
      npm: {
        shouldPublish: true,
      },
    },
  })

  await createNewPackage({
    name: 'b',
    version: '2.0.0',
    targetType: TargetType.npm,
  })

  const master2 = await runCi({
    targetsInfo: {
      npm: {
        shouldPublish: true,
      },
    },
  })

  expect(master2.published.get('a')?.npm?.versions).toEqual(['1.0.0'])
  expect(master2.published.get('b')?.npm?.versions).toEqual(['2.0.0'])
})
