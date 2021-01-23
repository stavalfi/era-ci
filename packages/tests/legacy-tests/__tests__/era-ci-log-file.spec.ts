import expect from 'expect'
import { newEnv, test } from './prepare-test'
import { manageStepResult } from './prepare-test/test-helpers'
import { TargetType } from './prepare-test/types'

const { createRepo } = newEnv(test)

test('ensure log file is created', async () => {
  const { runCi } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
        targetType: TargetType.npm,
      },
    ],
  })
  const result1 = await runCi({
    targetsInfo: {
      npm: {
        shouldPublish: false,
        shouldDeploy: false,
      },
    },
  })
  expect(result1.flowId).toBeTruthy()
  expect(result1.ncLogfileContent).toMatch(result1.flowId!)
})

test('ensure log file is deleted when a new flow starts', async () => {
  const { runCi } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
        targetType: TargetType.npm,
      },
    ],
  })
  const result1 = await runCi({
    targetsInfo: {
      npm: {
        shouldPublish: false,
        shouldDeploy: false,
      },
    },
  })

  const result2 = await runCi({
    targetsInfo: {
      npm: {
        shouldPublish: false,
        shouldDeploy: false,
      },
    },
  })

  expect(result2.ncLogfileContent).not.toEqual(expect.stringContaining(`flow-id: "${result1.flowId}"`))
  expect(result2.ncLogfileContent).toEqual(expect.stringContaining(`flow-id: "${result2.flowId}"`))
})

test('ensure any user-command that we run will be sent to the log file - user command passed', async () => {
  const test = await manageStepResult()

  const { runCi } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
        targetType: TargetType.npm,
        scripts: {
          test: test.stepScript,
        },
      },
    ],
  })

  await test.makeStepPass()

  const result1 = await runCi({
    targetsInfo: {
      npm: {
        shouldPublish: false,
        shouldDeploy: false,
      },
    },
  })
  expect(result1.ncLogfileContent).toMatch(test.expectedContentInLog())
})

test('ensure any user-command that we run will be sent to the log file - user command failed', async () => {
  const test = await manageStepResult()

  const { runCi } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
        targetType: TargetType.npm,
        scripts: {
          test: test.stepScript,
        },
      },
    ],
  })

  await test.makeStepFail()

  const result1 = await runCi({
    targetsInfo: {
      npm: {
        shouldPublish: false,
        shouldDeploy: false,
      },
    },
    execaOptions: {
      reject: false,
    },
  })
  expect(result1.ncLogfileContent).toMatch(test.expectedContentInLog())
})
