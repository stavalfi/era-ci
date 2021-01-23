import expect from 'expect'
import { newEnv } from '../../../prepare-test'
import { TargetType } from '../../../prepare-test/types'
import { describe, test } from '../../../prepare-test'

const { createRepo } = newEnv(test)

// NOTE: this tests are legacy and can be removed if needed

describe('run ci -> decrease packageJson.version -> run ci', () => {
  test('decrease to unpublished version', async () => {
    const { runCi, modifyPackageJson, gitHeadCommit } = await createRepo({
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

    const head1 = await gitHeadCommit()

    await modifyPackageJson('a', packageJson => ({ ...packageJson, version: '1.0.8' }))

    const master = await runCi({
      targetsInfo: {
        docker: {
          shouldPublish: true,
          shouldDeploy: false,
        },
      },
    })

    expect(master.published.get('a')?.docker?.tags).toEqual(expect.arrayContaining([head1, await gitHeadCommit()]))
  })

  test('decrease to published version', async () => {
    const { runCi, modifyPackageJson, addRandomFileToPackage, gitHeadCommit } = await createRepo({
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

    const head1 = await gitHeadCommit()

    await addRandomFileToPackage('a')

    await runCi({
      targetsInfo: {
        docker: {
          shouldPublish: true,
          shouldDeploy: false,
        },
      },
    })

    const head2 = await gitHeadCommit()

    await addRandomFileToPackage('a')

    await runCi({
      targetsInfo: {
        docker: {
          shouldPublish: true,
          shouldDeploy: false,
        },
      },
    })

    const head3 = await gitHeadCommit()

    await modifyPackageJson('a', packageJson => ({ ...packageJson, version: '1.0.1' }))

    const master = await runCi({
      targetsInfo: {
        docker: {
          shouldPublish: true,
          shouldDeploy: false,
        },
      },
    })

    const head4 = await gitHeadCommit()

    expect(master.published.get('a')?.docker?.tags).toEqual(expect.arrayContaining([head1, head2, head3, head4]))
  })
})
