import expect from 'expect'
import { newEnv, test } from './prepare-test'
import { TargetType } from './prepare-test/types'

const { createRepo } = newEnv(test)

test('multiple packages - all publish again because of modification in root files', async t => {
  const { runCi, addRandomFileToRoot } = await createRepo(t, {
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

  const master1 = await runCi({
    targetsInfo: {
      npm: {
        shouldPublish: true,
        shouldDeploy: false,
      },
    },
  })

  expect(master1.published.get('a')?.npm?.versions).toEqual(['1.0.0'])
  expect(master1.published.get('b')?.npm?.versions).toEqual(['2.0.0'])

  await addRandomFileToRoot()

  const master2 = await runCi({
    targetsInfo: {
      npm: {
        shouldPublish: true,
        shouldDeploy: false,
      },
    },
  })

  expect(master2.published.get('a')?.npm?.versions).toEqual(['1.0.0', '1.0.1'])
  expect(master2.published.get('a')?.npm?.highestVersion).toEqual('1.0.1')
  expect(master2.published.get('b')?.npm?.versions).toEqual(['2.0.0', '2.0.1'])
  expect(master2.published.get('b')?.npm?.highestVersion).toEqual('2.0.1')
})

test('multiple packages - all publish again because of modification in each package', async t => {
  const { runCi, addRandomFileToPackage } = await createRepo(t, {
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

  const master1 = await runCi({
    targetsInfo: {
      npm: {
        shouldPublish: true,
        shouldDeploy: false,
      },
    },
  })

  expect(master1.published.get('a')?.npm?.versions).toEqual(['1.0.0'])
  expect(master1.published.get('b')?.npm?.versions).toEqual(['2.0.0'])

  await addRandomFileToPackage('a')
  await addRandomFileToPackage('b')

  const master2 = await runCi({
    targetsInfo: {
      npm: {
        shouldPublish: true,
        shouldDeploy: false,
      },
    },
  })

  expect(master2.published.get('a')?.npm?.versions).toEqual(['1.0.0', '1.0.1'])
  expect(master2.published.get('a')?.npm?.highestVersion).toEqual('1.0.1')
  expect(master2.published.get('b')?.npm?.versions).toEqual(['2.0.0', '2.0.1'])
  expect(master2.published.get('b')?.npm?.highestVersion).toEqual('2.0.1')
})

test(`no publish if the package folder name has modified`, async t => {
  const { runCi, renamePackageFolder } = await createRepo(t, {
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

  await renamePackageFolder('a')

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

test(`no publish if the package folder moved`, async t => {
  const { runCi, movePackageFolder } = await createRepo(t, {
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

test(`no publish of other packages if a package was deleted`, async t => {
  const { runCi, deletePackage } = await createRepo(t, {
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

test(`no publish of other packages if addtional package was created`, async t => {
  const { runCi, createNewPackage } = await createRepo(t, {
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
