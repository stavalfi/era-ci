import expect from 'expect'
import { newEnv, test } from './prepare-test'
import { manageStepResult } from './prepare-test/test-helpers'
import { TargetType } from './prepare-test/types'

const { createRepo } = newEnv(test)

test('make sure tests output is printed', async t => {
  t.timeout(50 * 1000)

  const test = await manageStepResult()

  const { runCi } = await createRepo(t, {
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

  const { ciProcessResult } = await runCi({
    execaOptions: {
      stdio: 'pipe',
    },
  })

  expect(ciProcessResult.stdout).toContain(test.expectedContentInLog())
})

test('make sure ci fails if tests fails', async t => {
  t.timeout(50 * 1000)

  const test = await manageStepResult()

  const { runCi } = await createRepo(t, {
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
  expect(result.ciProcessResult.failed).toBeTruthy()
  // todo: find a way to check in the report that a-package failed in test-step
})

test('multiple packages', async t => {
  t.timeout(50 * 1000)

  const aTest = await manageStepResult()
  const bTest = await manageStepResult()

  const { runCi } = await createRepo(t, {
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

  expect(result.ciProcessResult.failed).toBeTruthy()
})

test('skip package with passed tests', async t => {
  t.timeout(50 * 1000)

  const test = await manageStepResult()
  const { runCi } = await createRepo(t, {
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

test('skip package with failed tests', async t => {
  t.timeout(50 * 1000)

  const test = await manageStepResult()
  const { runCi } = await createRepo(t, {
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

  expect(pr.ciProcessResult.failed).toBeTruthy()
  // todo: find a way to check in the report that a-package failed in test-step
})

test('run tests of package after the package changed even if the tests passed at the first run', async t => {
  t.timeout(50 * 1000)

  const test = await manageStepResult()
  const { runCi, addRandomFileToPackage } = await createRepo(t, {
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

  expect(result.ciProcessResult.failed).toBeTruthy()
  // todo: find a way to check in the report that a-package failed in test-step
})
