import expect from 'expect'
import { newEnv } from '../prepare-test'
import { TargetType } from '../prepare-test/types'

const { createRepo } = newEnv()

test(`no publish if the package folder moved`, async () => {
  const { runCi, movePackageFolder } = await createRepo({
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
        shouldDeploy: false,
      },
    },
  })

  await movePackageFolder('a')

  const master2 = await runCi({
    targetsInfo: {
      npm: {
        shouldPublish: true,
        shouldDeploy: false,
      },
    },
  })

  expect(master2.published.get('a')?.npm?.versions).toEqual(['1.0.0'])
})

test(`no publish of other packages if a package was deleted`, async () => {
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
        shouldDeploy: false,
      },
    },
  })

  await deletePackage('a')

  const master2 = await runCi({
    targetsInfo: {
      npm: {
        shouldPublish: true,
        shouldDeploy: false,
      },
    },
  })

  expect(master2.published.get('b')?.npm?.versions).toEqual(['2.0.0'])
})

test(`no publish of other packages if addtional package was created`, async () => {
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
        shouldDeploy: false,
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
        shouldDeploy: false,
      },
    },
  })

  expect(master2.published.get('a')?.npm?.versions).toEqual(['1.0.0'])
  expect(master2.published.get('b')?.npm?.versions).toEqual(['2.0.0'])
})
