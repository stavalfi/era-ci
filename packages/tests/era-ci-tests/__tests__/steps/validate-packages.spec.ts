import { createRepo, createTest, DeepPartial, isDeepSubset, test } from '@era-ci/e2e-tests-infra'
import { JsonReport, validatePackages } from '@era-ci/steps'
import { createLinearStepsGraph } from '@era-ci/steps-graph'
import { ExecutionStatus, Status } from '@era-ci/utils'
import expect from 'expect'

createTest(test)

test('validate-packages-step should pass', async t => {
  const { runCi } = await createRepo(t, {
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
        },
      ],
    },
    configurations: {
      steps: createLinearStepsGraph([validatePackages()]),
    },
  })
  const { jsonReport } = await runCi()

  const expectedJsonReport: DeepPartial<JsonReport> = {
    flowResult: {
      executionStatus: ExecutionStatus.done,
      status: Status.passed,
    },
  }

  expect(isDeepSubset(jsonReport, expectedJsonReport)).toBeTruthy()
})
