import { ExecutionStatus, Status } from '@tahini/utils'
import { JsonReport } from '@tahini/steps'
import { createTest, DeepPartial, isDeepSubset } from '@tahini/e2e-tests-infra'

const { createRepo } = createTest()

test('ensure ci dont fail when there are no steps', async () => {
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
      steps: [],
    },
    dontAddReportSteps: true,
  })
  const { passed } = await runCi()
  expect(passed).toBeTruthy()
})

test('ensure json-report contains the corrent flow-id', async () => {
  const { runCi } = await createRepo({
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
        },
      ],
    },
  })

  const { jsonReport, flowId } = await runCi()

  expect(jsonReport.flow.flowId).toEqual(flowId)
})

test('ensure json-report contains the all the steps until it (not included)', async () => {
  const { runCi } = await createRepo({
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
        },
      ],
    },
  })

  const { jsonReport } = await runCi()

  expect(jsonReport.steps).toEqual([])
  expect(jsonReport.steps).toEqual(expect.arrayContaining(jsonReport.steps))
})

test('flow should be skippedAsPassed because there are no steps', async () => {
  const { runCi } = await createRepo({
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
        },
      ],
    },
  })

  const { jsonReport } = await runCi()

  const expectedJsonReport: DeepPartial<JsonReport> = {
    flowResult: {
      notes: [],
      errors: [],
      executionStatus: ExecutionStatus.aborted,
      status: Status.skippedAsPassed,
    },
  }

  expect(isDeepSubset(jsonReport, expectedJsonReport)).toBeTruthy()
})

test('verify artifact in json-report', async () => {
  const { runCi, toActualName } = await createRepo({
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
        },
      ],
    },
  })
  const { jsonReport } = await runCi()

  const expectedJsonReport: DeepPartial<JsonReport> = {
    artifacts: [
      {
        data: {
          artifact: {
            packageJson: {
              name: toActualName('a'),
            },
          },
        },
      },
    ],
  }

  expect(isDeepSubset(jsonReport, expectedJsonReport)).toBeTruthy()
})
