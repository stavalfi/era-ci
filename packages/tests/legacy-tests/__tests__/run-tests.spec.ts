import { test, expect } from '@jest/globals'
import { newEnv } from './prepare-test'
import { manageStepResult } from './prepare-test/test-helpers'
import { TargetType } from './prepare-test/types'

const { createRepo } = newEnv()

test('make sure tests output is printed', async () => {
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

  const { flowLogs } = await runCi({
    execaOptions: {
      stdio: 'pipe',
    },
  })

  expect(flowLogs).toContain(test.expectedContentInLog())
})

test('make sure ci fails if tests fails', async () => {
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

  const result = await runCi({
    execaOptions: {
      reject: false,
    },
  })
  expect(!result.passed).toBeTruthy()
  // todo: find a way to check in the report that a-package failed in test-step
})

test('multiple packages', async () => {
  const aTest = await manageStepResult()
  const bTest = await manageStepResult()

  const { runCi } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
        targetType: TargetType.npm,
        scripts: {
          test: aTest.stepScript,
        },
      },
      {
        name: 'b',
        version: '1.0.0',
        targetType: TargetType.npm,
        scripts: {
          test: bTest.stepScript,
        },
      },
    ],
  })

  await aTest.makeStepFail()
  await bTest.makeStepFail()

  const result = await runCi({
    execaOptions: {
      reject: false,
    },
  })

  expect(!result.passed).toBeTruthy()
})

test('skip package with passed tests', async () => {
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

  await runCi()

  await test.makeStepFail()

  await expect(runCi()).resolves.toBeTruthy()
})

test('skip package with failed tests', async () => {
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

  await runCi({
    execaOptions: {
      reject: false,
    },
  })

  await test.makeStepPass()

  const pr = await runCi({
    execaOptions: {
      reject: false,
    },
  })

  expect(!pr.passed).toBeTruthy()
  // todo: find a way to check in the report that a-package failed in test-step
})

test('run tests of package after the package changed even if the tests passed at the first run', async () => {
  const test = await manageStepResult()
  const { runCi, addRandomFileToPackage } = await createRepo({
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

  await runCi()

  await addRandomFileToPackage('a')
  await test.makeStepFail()

  const result = await runCi({
    execaOptions: {
      reject: false,
    },
  })

  expect(!result.passed).toBeTruthy()
  // todo: find a way to check in the report that a-package failed in test-step
})
