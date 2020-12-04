import { ExecutionStatus, Status } from '@tahini/utils'
import { JsonReport } from '@tahini/steps'
import { createTest, DeepPartial, isDeepSubsetOfOrPrint } from '@tahini/e2e-tests-infra'

const { createRepo } = createTest()

test('ensure ci dont fail when there are no steps', async () => {
  const { runCi } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
      },
    ],
  })
  const { passed } = await runCi(
    {
      steps: [],
    },
    {
      dontAddReportSteps: true,
    },
  )
  expect(passed).toBeTruthy()
})

test('ensure json-report contains the corrent flow-id', async () => {
  const { runCi } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
      },
    ],
  })

  const { jsonReport, flowId } = await runCi()

  expect(jsonReport.flow.flowId).toEqual(flowId)
})

test('ensure json-report contains the all the steps until it (not included)', async () => {
  const { runCi } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
      },
    ],
  })

  const { jsonReport } = await runCi()

  expect(jsonReport.steps).toEqual([])
  expect(jsonReport.steps).toEqual(expect.arrayContaining(jsonReport.steps))
})

test('flow should be skippedAsPassed because there are no steps', async () => {
  const { runCi } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
      },
    ],
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

  expect(isDeepSubsetOfOrPrint(jsonReport, expectedJsonReport)).toBeTruthy()
})

test('verify artifact in json-report', async () => {
  const { runCi, toActualName } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
      },
    ],
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

  expect(isDeepSubsetOfOrPrint(jsonReport, expectedJsonReport)).toBeTruthy()
})
