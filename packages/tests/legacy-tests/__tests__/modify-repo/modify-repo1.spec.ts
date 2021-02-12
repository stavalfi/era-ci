import expect from 'expect'
import { newEnv } from '../prepare-test'
import { TargetType } from '../prepare-test/types'

const { createRepo } = newEnv()

test('multiple packages - all publish again because of modification in root files', async () => {
  const { runCi, addRandomFileToRoot } = await createRepo({
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

test('multiple packages - all publish again because of modification in each package', async () => {
  const { runCi, addRandomFileToPackage } = await createRepo({
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

test(`no publish if the package folder name has modified`, async () => {
  const { runCi, renamePackageFolder } = await createRepo({
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
