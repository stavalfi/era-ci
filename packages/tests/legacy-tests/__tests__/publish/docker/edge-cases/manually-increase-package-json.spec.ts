import { newEnv } from '../../../prepare-test'
import { TargetType } from '../../../prepare-test/types'

const { createRepo } = newEnv()

// NOTE: this tests are legacy and can be removed if needed

describe('run ci -> increase packageJson.version -> run ci', () => {
  test('run ci -> increase packageJson.version in major -> run ci', async () => {
    const { runCi, modifyPackageJson, gitHeadCommit } = await createRepo({
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

    await modifyPackageJson('a', packageJson => ({ ...packageJson, version: '2.0.0' }))

    const master = await runCi({
      targetsInfo: {
        docker: {
          shouldPublish: true,
          shouldDeploy: false,
        },
      },
    })

    const head2 = await gitHeadCommit()

    expect(master.published.get('a')?.docker?.tags.sort()).toEqual([head1, head2].sort())
  })

  test('run ci -> increase packageJson.version in minor -> run ci', async () => {
    const { runCi, modifyPackageJson, gitHeadCommit } = await createRepo({
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

    await modifyPackageJson('a', packageJson => ({ ...packageJson, version: '1.1.0' }))

    const master = await runCi({
      targetsInfo: {
        docker: {
          shouldPublish: true,
          shouldDeploy: false,
        },
      },
    })
    const head2 = await gitHeadCommit()

    expect(master.published.get('a')?.docker?.tags.sort()).toEqual([head1, head2].sort())
  })

  test('run ci -> increase packageJson.version in patch (should be next version anyway) -> run ci', async () => {
    const { runCi, modifyPackageJson, gitHeadCommit } = await createRepo({
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

    await modifyPackageJson('a', packageJson => ({ ...packageJson, version: '1.0.1' }))

    const master = await runCi({
      targetsInfo: {
        docker: {
          shouldPublish: true,
          shouldDeploy: false,
        },
      },
    })
    const head2 = await gitHeadCommit()

    expect(master.published.get('a')?.docker?.tags.sort()).toEqual([head1, head2].sort())
  })

  test('run ci -> increase packageJson.version in patch -> run ci', async () => {
    const { runCi, modifyPackageJson, gitHeadCommit } = await createRepo({
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

    await modifyPackageJson('a', packageJson => ({ ...packageJson, version: '1.0.4' }))

    const master = await runCi({
      targetsInfo: {
        docker: {
          shouldPublish: true,
          shouldDeploy: false,
        },
      },
    })
    const head2 = await gitHeadCommit()

    expect(master.published.get('a')?.docker?.tags.sort()).toEqual([head1, head2].sort())
  })
})
