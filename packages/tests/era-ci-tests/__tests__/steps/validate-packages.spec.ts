import { createTest, DeepPartial, isDeepSubset } from '@era-ci/e2e-tests-infra'
import { JsonReport, validatePackages } from '@era-ci/steps'
import { createLinearStepsGraph } from '@era-ci/steps-graph'
import { ExecutionStatus, Status } from '@era-ci/utils'
import expect from 'expect'

const { createRepo } = createTest()

test('validate-packages-step should pass', async () => {
  const { runCi } = await createRepo({
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
