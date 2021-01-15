import expect from 'expect'
import { describe, newEnv, test } from './prepare-test'
import { manageStepResult } from './prepare-test/test-helpers'
import { TargetType } from './prepare-test/types'

const { createRepo } = newEnv(test)

describe('skip publish of package that did not change from the last publish', () => {
  test('npm - publish passed so there is no need to publish again', async t => {
    const { runCi } = await createRepo(t, {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
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

  test('docker - publish passed so there is no need to publish again', async t => {
    const { runCi, gitHeadCommit } = await createRepo(t, {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          targetType: TargetType.docker,
        },
      ],
    })
    const master1 = await runCi({
      targetsInfo: {
        docker: {
          shouldPublish: true,
          shouldDeploy: false,
        },
      },
    })
    expect(master1.published.get('a')?.docker?.tags).toEqual(expect.arrayContaining([await gitHeadCommit()]))
    const master2 = await runCi({
      targetsInfo: {
        docker: {
          shouldPublish: true,
          shouldDeploy: false,
        },
      },
    })
    expect(master2.published.get('a')?.docker?.tags).toEqual(expect.arrayContaining([await gitHeadCommit()]))
  })

  test('publish failed we will try to publish again in the nest flow even when the package-hash did not change', async t => {
    const aPublish = await manageStepResult()
    const { runCi } = await createRepo(t, {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          targetType: TargetType.npm,
          scripts: {
            postpublish: aPublish.stepScript, // it will be called by yarn after the CI will call `yarn publish`
          },
        },
      ],
    })

    await aPublish.makeStepFail()

    const master1 = await runCi({
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
    expect(master1.ciProcessResult.failed).toBeTruthy()

    await aPublish.makeStepPass()

    const master2 = await runCi({
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
    expect(master2.ciProcessResult.failed).toBeFalsy()
  })
})

test('multiple packages - publish again changed package', async t => {
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
  expect(master2.published.get('b')?.npm?.versions).toEqual(['2.0.0'])
})

test('no addtional publish of the same package with the exact same content', async t => {
  const { runCi, modifyPackageJson } = await createRepo(t, {
    packages: [
      {
        name: 'a',
        version: '1.0.0',
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

  await modifyPackageJson('a', packageJson => ({
    ...packageJson,
    author: 'stav',
  }))

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

  await modifyPackageJson('a', packageJson => {
    const shallowCopy = { ...packageJson }
    delete shallowCopy.author
    return shallowCopy
  })

  const master3 = await runCi({
    targetsInfo: {
      npm: {
        shouldPublish: true,
        shouldDeploy: false,
      },
    },
  })
  expect(master3.published.get('a')?.npm?.versions).toEqual(['1.0.0', '1.0.1'])
  expect(master3.published.get('a')?.npm?.highestVersion).toEqual('1.0.1')
})
