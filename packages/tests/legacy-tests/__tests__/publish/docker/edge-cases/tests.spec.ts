import { newEnv } from '../../../prepare-test'
import { TargetType } from '../../../prepare-test/types'

const { createRepo } = newEnv()

test(`run ci as the first time after there is already a docker publish`, async () => {
  const { runCi, publishDockerPackageWithoutCi } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
        targetType: TargetType.docker,
      },
    ],
  })

  await publishDockerPackageWithoutCi('a', '1.0.0')

  const master = await runCi({
    targetsInfo: {
      docker: {
        shouldPublish: true,
        shouldDeploy: false,
      },
    },
  })
  expect(master.published.get('a')?.docker?.tags).toEqual(['1.0.0', '1.0.1'])
})

test(`run ci -> override all labels in registry with empty values -> run ci`, async () => {
  const { runCi, publishDockerPackageWithoutCi, addRandomFileToPackage } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
        targetType: TargetType.docker,
      },
    ],
  })

  await runCi({
    targetsInfo: {
      docker: {
        shouldPublish: true,
        shouldDeploy: false,
      },
    },
  })

  await publishDockerPackageWithoutCi('a', '1.0.0', {
    'latest-hash': '',
    'latest-tag': '',
  })

  await addRandomFileToPackage('a')

  const master = await runCi({
    targetsInfo: {
      docker: {
        shouldPublish: true,
        shouldDeploy: false,
      },
    },
  })

  expect(master.published.get('a')?.docker?.tags).toEqual(['1.0.0', '1.0.1'])
})

test(`run ci -> override all labels in registry with invalid values -> run ci and ensure we can recover from that`, async () => {
  const { runCi, publishDockerPackageWithoutCi, addRandomFileToPackage } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
        targetType: TargetType.docker,
      },
    ],
  })

  await runCi({
    targetsInfo: {
      docker: {
        shouldPublish: true,
        shouldDeploy: false,
      },
    },
  })

  await publishDockerPackageWithoutCi('a', '1.0.1', {
    'latest-hash': 'invalid-hash-$%^&',
    'latest-tag': 'invalid-tag-$%^&',
  })

  await addRandomFileToPackage('a')

  const master = await runCi({
    targetsInfo: {
      docker: {
        shouldPublish: true,
        shouldDeploy: false,
      },
    },
  })

  expect(master.published.get('a')?.docker?.tags).toEqual(['1.0.0', '1.0.1', '1.0.2'])
})

test(`run ci -> override latest-hash label in registry with empty value -> run ci`, async () => {
  const { runCi, publishDockerPackageWithoutCi, addRandomFileToPackage } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
        targetType: TargetType.docker,
      },
    ],
  })

  await runCi({
    targetsInfo: {
      docker: {
        shouldPublish: true,
        shouldDeploy: false,
      },
    },
  })

  await publishDockerPackageWithoutCi('a', '1.0.1', {
    'latest-hash': '',
  })

  await addRandomFileToPackage('a')

  const master = await runCi({
    targetsInfo: {
      docker: {
        shouldPublish: true,
        shouldDeploy: false,
      },
    },
  })

  expect(master.published.get('a')?.docker?.tags).toEqual(['1.0.0', '1.0.1'])
})

test(`run ci -> override latest-tag label in registry with empty value -> run ci`, async () => {
  const { runCi, publishDockerPackageWithoutCi, addRandomFileToPackage } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
        targetType: TargetType.docker,
      },
    ],
  })

  await runCi({
    targetsInfo: {
      docker: {
        shouldPublish: true,
        shouldDeploy: false,
      },
    },
  })

  await publishDockerPackageWithoutCi('a', '1.0.1', {
    'latest-tag': '',
  })

  await addRandomFileToPackage('a')

  const master = await runCi({
    targetsInfo: {
      docker: {
        shouldPublish: true,
        shouldDeploy: false,
      },
    },
  })

  expect(master.published.get('a')?.docker?.tags).toEqual(['1.0.0', '1.0.1'])
})

test('run ci -> change packageJson.version to invalid version -> run ci', async () => {
  const { runCi, modifyPackageJson } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
        targetType: TargetType.docker,
      },
    ],
  })

  await modifyPackageJson('a', packageJson => ({ ...packageJson, version: 'lalalal' }))

  const result = await runCi({
    targetsInfo: {
      docker: {
        shouldPublish: true,
        shouldDeploy: false,
      },
    },
    execaOptions: {
      stdio: 'pipe',
      reject: false,
    },
  })

  expect(result.ciProcessResult.stdout).toEqual(expect.stringContaining('is invalid: "lalalal"'))
})
