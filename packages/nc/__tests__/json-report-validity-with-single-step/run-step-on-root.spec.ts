import { createStep, ExecutionStatus, Status } from '../../src'
import { createTest } from '../prepare-tests'

const { createRepo } = createTest()

test('flow should pass because step pass', async () => {
  const { runCi } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
      },
    ],
  })
  const { passed, jsonReport } = await runCi({
    steps: [
      createStep({
        stepName: 'step1',
        runStepOnRoot: async () => {
          return {
            notes: [],
            status: Status.passed,
          }
        },
      })(),
    ],
  })
  expect(passed).toBeTruthy()
  expect(jsonReport.flowResult.status).toEqual(Status.passed)
  expect(jsonReport.flowResult.notes).toEqual([])
  expect(jsonReport.flowResult.error).toBeFalsy()
})

test('step should pass in json-report', async () => {
  const { runCi, toActualName } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
      },
    ],
  })
  const { jsonReport } = await runCi({
    steps: [
      createStep({
        stepName: 'step1',
        runStepOnRoot: async () => {
          return {
            notes: [],
            status: Status.passed,
          }
        },
      })(),
    ],
  })
  expect(jsonReport.stepsResultOfArtifactsByStep).toHaveLength(1)
  expect(jsonReport.stepsResultOfArtifactsByStep[0].data.stepExecutionStatus).toEqual(ExecutionStatus.done)
  if (jsonReport.stepsResultOfArtifactsByStep[0].data.stepExecutionStatus === ExecutionStatus.done) {
    expect(jsonReport.stepsResultOfArtifactsByStep[0].data.stepResult.status).toEqual(Status.passed)
    expect(jsonReport.stepsResultOfArtifactsByStep[0].data.stepResult.notes).toHaveLength(0)
    expect(jsonReport.stepsResultOfArtifactsByStep[0].data.stepResult.error).toBeFalsy()
    expect(jsonReport.stepsResultOfArtifactsByStep[0].data.artifactsResult).toHaveLength(1)
    expect(jsonReport.stepsResultOfArtifactsByStep[0].data.artifactsResult[0].data.artifact.packageJson.name).toEqual(
      toActualName('a'),
    )
    expect(jsonReport.stepsResultOfArtifactsByStep[0].data.artifactsResult[0].data.artifactStepExecutionStatus).toEqual(
      ExecutionStatus.done,
    )
    expect(jsonReport.stepsResultOfArtifactsByStep[0].data.artifactsResult[0].data.artifactStepResult.status).toEqual(
      Status.passed,
    )
    expect(
      jsonReport.stepsResultOfArtifactsByStep[0].data.artifactsResult[0].data.artifactStepResult.notes,
    ).toHaveLength(0)
    expect(jsonReport.stepsResultOfArtifactsByStep[0].data.artifactsResult[0].data.artifactStepResult.error).toBeFalsy()
  }
})

test('flow should fail because step failed without throwing error from the step', async () => {
  const { runCi } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
      },
    ],
  })
  const { passed, jsonReport } = await runCi({
    steps: [
      createStep({
        stepName: 'step1',
        runStepOnRoot: async () => {
          return {
            notes: [],
            status: Status.failed,
          }
        },
      })(),
    ],
  })
  expect(passed).toBeFalsy()
  expect(jsonReport.flowResult.status).toEqual(Status.failed)
  expect(jsonReport.flowResult.error).toBeFalsy()
  expect(jsonReport.stepsResultOfArtifactsByStep[0].data.stepExecutionStatus).toEqual(ExecutionStatus.done)
  if (jsonReport.stepsResultOfArtifactsByStep[0].data.stepExecutionStatus === ExecutionStatus.done) {
    expect(jsonReport.stepsResultOfArtifactsByStep[0].data.stepResult.status).toEqual(Status.failed)
    expect(jsonReport.stepsResultOfArtifactsByStep[0].data.stepResult.notes).toHaveLength(0)
    expect(jsonReport.stepsResultOfArtifactsByStep[0].data.stepResult.error).toBeFalsy()
  }
})

test('flow should fail because step failed while throwing error from the step', async () => {
  const { runCi } = await createRepo({
    packages: [
      {
        name: 'a',
        version: '1.0.0',
      },
    ],
  })
  const { passed, jsonReport } = await runCi({
    steps: [
      createStep({
        stepName: 'step1',
        runStepOnRoot: async () => {
          throw new Error('error123')
        },
      })(),
    ],
  })
  expect(passed).toBeFalsy()
  expect(jsonReport.flowResult.status).toEqual(Status.failed)
  expect(jsonReport.flowResult.error).toBeFalsy()
  expect(jsonReport.stepsResultOfArtifactsByStep[0].data.stepExecutionStatus).toEqual(ExecutionStatus.done)
  if (jsonReport.stepsResultOfArtifactsByStep[0].data.stepExecutionStatus === ExecutionStatus.done) {
    expect(jsonReport.stepsResultOfArtifactsByStep[0].data.stepResult.status).toEqual(Status.failed)
    expect(jsonReport.stepsResultOfArtifactsByStep[0].data.stepResult.notes).toHaveLength(0)
    expect(jsonReport.stepsResultOfArtifactsByStep[0].data.stepResult.error).toEqual(
      expect.objectContaining({
        message: 'error123',
      }),
    )
  }
})
