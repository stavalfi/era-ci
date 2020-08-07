import { newEnv } from './prepare-test'
import { TargetType } from './prepare-test/types'
import { manageTest } from './prepare-test/test-helpers'

const { createRepo } = newEnv()

test('make sure tests output is printed', async () => {
  const test = await manageTest()

  const { runCi } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
        targetType: TargetType.npm,
        scripts: {
          test: test.testScript,
        },
      },
    ],
  })

  const { ciProcessResult } = await runCi({
    execaOptions: {
      stdio: 'pipe',
    },
  })

  expect(ciProcessResult.stdout).toContain(test.expectedContentInLog)
})

test('make sure ci fails if tests fails', async () => {
  const test = await manageTest()

  const { runCi } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
        targetType: TargetType.npm,
        scripts: {
          test: test.testScript,
        },
      },
    ],
  })

  await test.makeTestsFail()

  const result = await runCi({
    execaOptions: {
      reject: false,
    },
  })
  expect(result.ciProcessResult.failed).toBeTruthy()
  // todo: find a way to check in the report that a-package failed in test-step
})

test('multiple packages', async () => {
  const aTest = await manageTest()
  const bTest = await manageTest()

  const { runCi } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
        targetType: TargetType.npm,
        scripts: {
          test: aTest.testScript,
        },
      },
      {
        name: 'b',
        version: '1.0.0',
        targetType: TargetType.npm,
        scripts: {
          test: bTest.testScript,
        },
      },
    ],
  })

  await aTest.makeTestsFail()
  await bTest.makeTestsFail()

  const result = await runCi({
    execaOptions: {
      reject: false,
    },
  })

  expect(result.ciProcessResult.failed).toBeTruthy()
  // todo: find a way to check in the report that a-package,b-package failed in test-step
})

test('skip package with passed tests', async () => {
  const test = await manageTest()
  const { runCi } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
        targetType: TargetType.npm,
        scripts: {
          test: test.testScript,
        },
      },
    ],
  })

  await test.makeTestsPass()

  await runCi({})

  await test.makeTestsFail()

  await expect(runCi({})).resolves.toBeTruthy()
  // todo: find a way to check in the report that a-package passed in test-step
})

test('skip package with failed tests', async () => {
  const test = await manageTest()
  const { runCi } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
        targetType: TargetType.npm,
        scripts: {
          test: test.testScript,
        },
      },
    ],
  })

  await test.makeTestsFail()

  await runCi({
    execaOptions: {
      reject: false,
    },
  })

  await test.makeTestsPass()

  const pr = await runCi({
    execaOptions: {
      reject: false,
    },
  })

  expect(pr.ciProcessResult.failed).toBeTruthy()
  // todo: find a way to check in the report that a-package failed in test-step
})

test('run tests of package after the package changed even if the tests passed at the first run', async () => {
  const test = await manageTest()
  const { runCi, addRandomFileToPackage } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
        targetType: TargetType.npm,
        scripts: {
          test: test.testScript,
        },
      },
    ],
  })

  await test.makeTestsPass()

  await runCi({})

  await addRandomFileToPackage('a')
  await test.makeTestsFail()

  const result = await runCi({
    execaOptions: {
      reject: false,
    },
  })

  expect(result.ciProcessResult.failed).toBeTruthy()
  // todo: find a way to check in the report that a-package failed in test-step
})
