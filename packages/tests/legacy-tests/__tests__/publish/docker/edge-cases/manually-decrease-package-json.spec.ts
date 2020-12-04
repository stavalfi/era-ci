import { newEnv } from '../../../prepare-test'
import { TargetType } from '../../../prepare-test/types'

const { createRepo } = newEnv()

describe('run ci -> decrease packageJson.version -> run ci', () => {
  test('decrease to unpublished version', async () => {
    const { runCi, modifyPackageJson } = await createRepo({
      packages: [
        {
          name: 'a',
          version: '1.0.10',
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

    await modifyPackageJson('a', packageJson => ({ ...packageJson, version: '1.0.8' }))

    const master = await runCi({
      targetsInfo: {
        docker: {
          shouldPublish: true,
          shouldDeploy: false,
        },
      },
    })

    expect(master.published.get('a')?.docker?.tags).toEqual(['1.0.10', '1.0.11'])
  })

  test('decrease to published version', async () => {
    const { runCi, modifyPackageJson, addRandomFileToPackage } = await createRepo({
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

    await addRandomFileToPackage('a')

    await runCi({
      targetsInfo: {
        docker: {
          shouldPublish: true,
          shouldDeploy: false,
        },
      },
    })

    await addRandomFileToPackage('a')

    await runCi({
      targetsInfo: {
        docker: {
          shouldPublish: true,
          shouldDeploy: false,
        },
      },
    })

    await modifyPackageJson('a', packageJson => ({ ...packageJson, version: '1.0.1' }))

    const master = await runCi({
      targetsInfo: {
        docker: {
          shouldPublish: true,
          shouldDeploy: false,
        },
      },
    })

    expect(master.published.get('a')?.docker?.tags).toEqual(['1.0.0', '1.0.1', '1.0.2', '1.0.3'])
  })
})
