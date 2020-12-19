import { createTest, DeepPartial, isDeepSubset } from '@tahini/e2e-tests-infra'
import { JsonReport, validatePackages } from '@tahini/steps'
import { createLinearStepsGraph } from '@tahini/steps-graph'
import { ExecutionStatus, Status } from '@tahini/utils'

const { createRepo } = createTest()

it('validate-packages-step should pass', async () => {
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
