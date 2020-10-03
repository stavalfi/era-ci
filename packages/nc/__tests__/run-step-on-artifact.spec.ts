import { createStep, ExecutionStatus, JsonReport, Status } from '../src'
import { createTest, DeepPartial, isDeepSubsetOfOrPrint } from './prepare-tests'

const { createRepo } = createTest()

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
        runStepOnArtifact: async () => {
          return {
            notes: [],
            status: Status.passed,
          }
        },
      })(),
    ],
  })

  const expectedJsonReport: DeepPartial<JsonReport> = {
    flowResult: {
      error: undefined,
      notes: [],
      status: Status.passed,
    },
    stepsResultOfArtifactsByStep: [
      {
        data: {
          stepInfo: {
            stepName: 'step1',
          },
          stepExecutionStatus: ExecutionStatus.done,
          stepResult: {
            error: undefined,
            notes: [],
            status: Status.passed,
          },
          artifactsResult: [
            {
              data: {
                artifactStepExecutionStatus: ExecutionStatus.done,
                artifact: {
                  packageJson: {
                    name: toActualName('a'),
                  },
                },
                artifactStepResult: {
                  error: undefined,
                  notes: [],
                  status: Status.passed,
                },
              },
            },
          ],
        },
      },
    ],
  }

  expect(isDeepSubsetOfOrPrint(jsonReport, expectedJsonReport)).toBeTruthy()
})

test('flow should fail because step failed (without throwing error from the step)', async () => {
  const { runCi, toActualName } = await createRepo({
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
        runStepOnArtifact: async () => {
          return {
            notes: [],
            status: Status.failed,
          }
        },
      })(),
    ],
  })

  expect(passed).toBeFalsy()

  const expectedJsonReport: DeepPartial<JsonReport> = {
    flowResult: {
      error: undefined,
      notes: [],
      status: Status.failed,
    },
    stepsResultOfArtifactsByStep: [
      {
        data: {
          stepInfo: {
            stepName: 'step1',
          },
          stepExecutionStatus: ExecutionStatus.done,
          stepResult: {
            error: undefined,
            notes: [],
            status: Status.failed,
          },
          artifactsResult: [
            {
              data: {
                artifactStepExecutionStatus: ExecutionStatus.done,
                artifact: {
                  packageJson: {
                    name: toActualName('a'),
                  },
                },
                artifactStepResult: {
                  error: undefined,
                  notes: [],
                  status: Status.failed,
                },
              },
            },
          ],
        },
      },
    ],
  }

  expect(isDeepSubsetOfOrPrint(jsonReport, expectedJsonReport)).toBeTruthy()
})

test('flow should fail because step failed (while throwing error from the step)', async () => {
  const { runCi, toActualName } = await createRepo({
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
        runStepOnArtifact: async () => {
          throw new Error('error123')
        },
      })(),
    ],
  })

  expect(passed).toBeFalsy()

  const expectedJsonReport: DeepPartial<JsonReport> = {
    flowResult: {
      error: undefined,
      notes: [],
      status: Status.failed,
    },
    stepsResultOfArtifactsByStep: [
      {
        data: {
          stepInfo: {
            stepName: 'step1',
          },
          stepExecutionStatus: ExecutionStatus.done,
          stepResult: {
            error: undefined,
            notes: [],
            status: Status.failed,
          },
          artifactsResult: [
            {
              data: {
                artifactStepExecutionStatus: ExecutionStatus.done,
                artifact: {
                  packageJson: {
                    name: toActualName('a'),
                  },
                },
                artifactStepResult: {
                  error: {
                    message: 'error123',
                  },
                  notes: [],
                  status: Status.failed,
                },
              },
            },
          ],
        },
      },
    ],
  }

  expect(isDeepSubsetOfOrPrint(jsonReport, expectedJsonReport)).toBeTruthy()
})
