import { Status } from '../src'
import { createTest } from './prepare-tests'

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
  const { passed } = await runCi()
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

test('flow should pass because there are no steps', async () => {
  const { runCi } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
      },
    ],
  })

  const { jsonReport } = await runCi()

  expect(jsonReport.flowResult.notes).toHaveLength(0)
  expect(jsonReport.flowResult.error).toBeFalsy()
  expect(jsonReport.flowResult.status).toEqual(Status.passed)
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
  expect(jsonReport.artifacts).toHaveLength(1)
  expect(jsonReport.artifacts[0].data.artifact.packageJson.name).toEqual(toActualName('a'))
})
