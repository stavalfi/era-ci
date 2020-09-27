import { newEnv } from '../prepare-test'
import { TargetType } from '../prepare-test/types'
import { manageStepResult } from '../prepare-test/test-helpers'

const { createRepo } = newEnv()

describe('publish only packages without failing tests', () => {
  test('tests failed so there is no publish', async () => {
    const aTests = await manageStepResult()
    const { runCi } = await createRepo({
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          targetType: TargetType.npm,
          scripts: {
            test: aTests.stepScript,
          },
        },
      ],
    })

    await aTests.makeStepFail()

    const master = await runCi({
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

    expect(master.published.get('a')?.npm?.versions).toBeFalsy()
  })

  test('tests passed so there is a publish', async () => {
    const aTests = await manageStepResult()
    const { runCi } = await createRepo({
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          targetType: TargetType.npm,
          scripts: {
            test: aTests.stepScript,
          },
        },
      ],
    })

    await aTests.makeStepPass()

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

  test('multiple packages - publish only packages with passed tests', async () => {
    const aTests = await manageStepResult()
    const bTests = await manageStepResult()
    const { runCi } = await createRepo({
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          targetType: TargetType.npm,
          scripts: {
            test: aTests.stepScript,
          },
        },
        {
          name: 'b',
          version: '2.0.0',
          targetType: TargetType.npm,
          scripts: {
            test: bTests.stepScript,
          },
        },
      ],
    })

    await aTests.makeStepFail()
    await bTests.makeStepPass()

    const master = await runCi({
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

    expect(master.published.get('a')?.npm?.versions).toBeFalsy()
    expect(master.published.get('b')?.npm?.versions).toEqual(['2.0.0'])
    expect(master.published.get('b')?.npm?.highestVersion).toEqual('2.0.0')
  })
})
