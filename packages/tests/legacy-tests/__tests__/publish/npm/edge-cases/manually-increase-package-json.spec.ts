import expect from 'expect'
import { describe, newEnv, test } from '../../../prepare-test'
import { TargetType } from '../../../prepare-test/types'

const { createRepo } = newEnv(test)

describe('run ci -> increase packageJson.version -> run ci', () => {
  test('run ci -> increase packageJson.version in major -> run ci', async t => {
    const { runCi, modifyPackageJson } = await createRepo(t, {
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

    await modifyPackageJson('a', packageJson => ({ ...packageJson, version: '2.0.0' }))

    const master = await runCi({
      targetsInfo: {
        npm: {
          shouldPublish: true,
          shouldDeploy: false,
        },
      },
    })

    expect(master.published.get('a')?.npm?.versions).toEqual(['1.0.0', '2.0.0'])
    expect(master.published.get('a')?.npm?.highestVersion).toEqual('2.0.0')
  })

  test('run ci -> increase packageJson.version in minor -> run ci', async t => {
    const { runCi, modifyPackageJson } = await createRepo(t, {
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

    await modifyPackageJson('a', packageJson => ({ ...packageJson, version: '1.1.0' }))

    const master = await runCi({
      targetsInfo: {
        npm: {
          shouldPublish: true,
          shouldDeploy: false,
        },
      },
    })
    expect(master.published.get('a')?.npm?.versions).toEqual(['1.0.0', '1.1.0'])
    expect(master.published.get('a')?.npm?.highestVersion).toEqual('1.1.0')
  })

  test('run ci -> increase packageJson.version in patch (should be next version anyway) -> run ci', async t => {
    const { runCi, modifyPackageJson } = await createRepo(t, {
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

    await modifyPackageJson('a', packageJson => ({ ...packageJson, version: '1.0.1' }))

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

  test('run ci -> increase packageJson.version in patch -> run ci', async t => {
    const { runCi, modifyPackageJson } = await createRepo(t, {
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

    await modifyPackageJson('a', packageJson => ({ ...packageJson, version: '1.0.4' }))

    const master = await runCi({
      targetsInfo: {
        npm: {
          shouldPublish: true,
          shouldDeploy: false,
        },
      },
    })
    expect(master.published.get('a')?.npm?.versions).toEqual(['1.0.0', '1.0.4'])
    expect(master.published.get('a')?.npm?.highestVersion).toEqual('1.0.4')
  })
})
