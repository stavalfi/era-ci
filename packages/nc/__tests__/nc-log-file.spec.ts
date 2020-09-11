import { newEnv } from './prepare-test'
import { TargetType } from './prepare-test/types'
import { manageStepResult } from './prepare-test/test-helpers'

const { createRepo } = newEnv()

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
  const flowId = result1.flowId as string

  const result2 = await runCi({
    targetsInfo: {
      npm: {
        shouldPublish: false,
        shouldDeploy: false,
      },
    },
  })

  // what do we do here: flow-id is the repo-hash so the flow-id
  //                     will be the same in both flows. we ensure
  //                     it was printed only once in the log file.

  const amountOfRepeats = result2.ncLogfileContent.split(`flow-id: "${flowId}"`).length - 1
  expect(amountOfRepeats).toEqual(1)
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
