import expect from 'expect'
import { newEnv } from '../../../prepare-test'
import { TargetType } from '../../../prepare-test/types'
import { test, describe } from '../../../prepare-test'

const { createRepo } = newEnv(test)

describe('run ci -> decrease packageJson.version -> run ci', () => {
  test('decrease to unpublished version', async t => {
    t.timeout(50 * 1000)

    const { runCi, modifyPackageJson } = await createRepo(t, {
      packages: [
        {
          name: 'a',
          version: '1.0.10',
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

    await modifyPackageJson('a', packageJson => ({ ...packageJson, version: '1.0.8' }))

    const master = await runCi({
      targetsInfo: {
        npm: {
          shouldPublish: true,
          shouldDeploy: false,
        },
      },
    })

    expect(master.published.get('a')?.npm?.versions).toEqual(['1.0.10', '1.0.11'])
    expect(master.published.get('a')?.npm?.highestVersion).toEqual('1.0.11')
  })

  test('decrease to published version', async t => {
    t.timeout(50 * 1000)

    const { runCi, modifyPackageJson, addRandomFileToPackage } = await createRepo(t, {
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

    await addRandomFileToPackage('a')

    await runCi({
      targetsInfo: {
        npm: {
          shouldPublish: true,
          shouldDeploy: false,
        },
      },
    })

    await addRandomFileToPackage('a')

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

    expect(master.published.get('a')?.npm?.versions).toEqual(['1.0.0', '1.0.1', '1.0.2', '1.0.3'])
    expect(master.published.get('a')?.npm?.highestVersion).toEqual('1.0.3')
  })
})
