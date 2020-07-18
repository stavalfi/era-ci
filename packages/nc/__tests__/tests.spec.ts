import { newEnv } from './prepare-test'
import { TargetType } from './prepare-test/types'
import { manageTest } from './prepare-test/test-helpers'

const { createRepo } = newEnv()

test('do not run tests if skip-tests option is enabled', async () => {
  const { runCi } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
        targetType: TargetType.npm,
        scripts: {
          test: 'echo running-very-nice-tests',
        },
      },
    ],
  })

  const { ciProcessResult } = await runCi({
    isMasterBuild: false,
    skipTests: true,
    execaOptions: {
      stdio: 'pipe',
    },
  })

  expect(ciProcessResult.stdout).not.toContain('echo running-very-nice-tests')
})

test('make sure tests output is printed', async () => {
  const { runCi } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
        targetType: TargetType.npm,
        scripts: {
          test: 'echo running-very-nice-tests',
        },
      },
    ],
  })

  const { ciProcessResult } = await runCi({
    isMasterBuild: false,
    execaOptions: {
      stdio: 'pipe',
    },
  })

  expect(ciProcessResult.stdout).toContain('echo running-very-nice-tests')
})

test('make sure ci fails if tests fails', async () => {
  const { runCi } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
        targetType: TargetType.npm,
        scripts: {
          test: 'exit 12345',
        },
      },
    ],
  })

  const result = await runCi({
    isMasterBuild: false,
    execaOptions: {
      stdio: 'pipe',
      reject: false,
    },
  })
  expect(result.ciProcessResult.failed).toBeTruthy()
  expect(result.ciProcessResult.stderr).toMatch(/packages with failed tests: a/)
})

test('multiple packages', async () => {
  const { runCi } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
        targetType: TargetType.npm,
        scripts: {
          test: 'exit 12345',
        },
      },
      {
        name: 'b',
        version: '1.0.0',
        targetType: TargetType.npm,
        scripts: {
          test: 'exit 12345',
        },
      },
    ],
  })

  const result = await runCi({
    isMasterBuild: false,
    execaOptions: {
      stdio: 'pipe',
      reject: false,
    },
  })

  expect(result.ciProcessResult.failed).toBeTruthy()
  expect(result.ciProcessResult.stderr).toMatch(/packages with failed tests: a.* b.*/)
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

  await runCi({
    isMasterBuild: false,
  })

  await test.makeTestsFail()

  const pr = await runCi({
    isMasterBuild: false,
    execaOptions: {
      stdio: 'pipe',
    },
  })

  expect(pr.ciProcessResult.stdout).toEqual(
    expect.stringContaining('nothing changed and tests already passed in last builds'),
  )
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
    isMasterBuild: false,
    execaOptions: {
      reject: false,
    },
  })

  await test.makeTestsPass()

  const pr = await runCi({
    isMasterBuild: false,
    execaOptions: {
      stdio: 'pipe',
      reject: false,
    },
  })

  expect(pr.ciProcessResult.stdout).toEqual(
    expect.stringContaining(
      'nothing changed and tests already failed in last builds.\
if you have falky tests, please fix them or make a small change\
in your package to force the tests will run again',
    ),
  )
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

  await runCi({
    isMasterBuild: false,
  })

  await addRandomFileToPackage('a')
  await test.makeTestsFail()

  const result = await runCi({
    isMasterBuild: false,
    execaOptions: {
      stdio: 'pipe',
      reject: false,
    },
  })

  expect(result.ciProcessResult.stderr).toMatch(/packages with failed tests: a/)
})
