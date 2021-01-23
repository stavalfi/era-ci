import expect from 'expect'
import { newEnv } from '../../../prepare-test'
import { TargetType } from '../../../prepare-test/types'

const { createRepo } = newEnv()

test(`run ci as the first time after there is already an npm publish`, async () => {
  const { runCi, publishNpmPackageWithoutCi } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
        targetType: TargetType.npm,
      },
    ],
  })

  await publishNpmPackageWithoutCi('a')

  const master = await runCi({
    targetsInfo: {
      npm: {
        shouldPublish: true,
        shouldDeploy: false,
      },
    },
  })
  expect(master.published.get('a')?.npm?.versions).toEqual(['1.0.0', '1.0.1'])
  expect(master.published.get('a')?.npm?.highestVersion).toEqual('1.0.1')
})

test(`run ci -> unpublish npm while keeping hashes in redis that indicate that we dont need to\
 publish again - but we should because the package is not in the registry -> run ci`, async () => {
  const { runCi, unpublishNpmPackage } = await createRepo({
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

  await unpublishNpmPackage('a', '1.0.0')

  const master = await runCi({
    targetsInfo: {
      npm: {
        shouldPublish: true,
        shouldDeploy: false,
      },
    },
  })

  expect(master.published.get('a')?.npm?.versions).toEqual(['1.0.0'])
  expect(master.published.get('a')?.npm?.highestVersion).toEqual('1.0.0')
})

test(`run ci -> remove all npm hash tags -> run ci`, async () => {
  const { runCi, removeAllNpmHashTags } = await createRepo({
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

  await removeAllNpmHashTags('a')

  const master = await runCi({
    targetsInfo: {
      npm: {
        shouldPublish: true,
        shouldDeploy: false,
      },
    },
  })

  expect(master.published.get('a')?.npm?.versions).toEqual(['1.0.0', '1.0.1'])
  expect(master.published.get('a')?.npm?.highestVersion).toEqual('1.0.1')
})

test('run ci -> change packageJson.version to invalid version -> run ci', async () => {
  const { runCi, modifyPackageJson } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
        targetType: TargetType.npm,
      },
    ],
  })

  await modifyPackageJson('a', packageJson => ({ ...packageJson, version: 'lalalal' }))

  const result = await runCi({
    targetsInfo: {
      npm: {
        shouldPublish: true,
        shouldDeploy: false,
      },
    },
    execaOptions: {
      reject: false,
    },
  })
  expect(result.ncLogfileContent).toEqual(expect.stringContaining('is invalid: "lalalal"'))
})
