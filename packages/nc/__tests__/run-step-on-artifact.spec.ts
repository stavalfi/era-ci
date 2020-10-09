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
            executionStatus: ExecutionStatus.done,
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
      executionStatus: ExecutionStatus.done,
      status: Status.passed,
    },
    stepsResultOfArtifactsByStep: [
      {
        data: {
          stepInfo: {
            stepName: 'step1',
          },
          stepResult: {
            error: undefined,
            notes: [],
            executionStatus: ExecutionStatus.done,
            status: Status.passed,
          },
          artifactsResult: [
            {
              data: {
                artifact: {
                  packageJson: {
                    name: toActualName('a'),
                  },
                },
                artifactStepResult: {
                  error: undefined,
                  notes: [],
                  executionStatus: ExecutionStatus.done,
                  status: Status.passed,
                },
              },
            },
          ],
        },
      },
    ],
    stepsResultOfArtifactsByArtifact: [
      {
        data: {
          artifact: {
            packageJson: {
              name: toActualName('a'),
            },
          },
          artifactResult: {
            error: undefined,
            notes: [],
            executionStatus: ExecutionStatus.done,
            status: Status.passed,
          },
          stepsResult: [
            {
              data: {
                stepInfo: {
                  stepName: 'step1',
                },
                artifactStepResult: {
                  error: undefined,
                  notes: [],
                  executionStatus: ExecutionStatus.done,
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
            executionStatus: ExecutionStatus.done,
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
      executionStatus: ExecutionStatus.done,
      status: Status.failed,
    },
    stepsResultOfArtifactsByStep: [
      {
        data: {
          stepInfo: {
            stepName: 'step1',
          },
          stepResult: {
            error: undefined,
            notes: [],
            executionStatus: ExecutionStatus.done,
            status: Status.failed,
          },
          artifactsResult: [
            {
              data: {
                artifact: {
                  packageJson: {
                    name: toActualName('a'),
                  },
                },
                artifactStepResult: {
                  error: undefined,
                  notes: [],
                  executionStatus: ExecutionStatus.done,
                  status: Status.failed,
                },
              },
            },
          ],
        },
      },
    ],
    stepsResultOfArtifactsByArtifact: [
      {
        data: {
          artifact: {
            packageJson: {
              name: toActualName('a'),
            },
          },
          artifactResult: {
            error: undefined,
            notes: [],
            executionStatus: ExecutionStatus.done,
            status: Status.failed,
          },
          stepsResult: [
            {
              data: {
                stepInfo: {
                  stepName: 'step1',
                },
                artifactStepResult: {
                  error: undefined,
                  executionStatus: ExecutionStatus.done,
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
          stepResult: {
            error: undefined,
            notes: [],
            executionStatus: ExecutionStatus.done,
            status: Status.failed,
          },
          artifactsResult: [
            {
              data: {
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
                  executionStatus: ExecutionStatus.done,
                  status: Status.failed,
                },
              },
            },
          ],
        },
      },
    ],
    stepsResultOfArtifactsByArtifact: [
      {
        data: {
          artifact: {
            packageJson: {
              name: toActualName('a'),
            },
          },
          artifactResult: {
            error: undefined,
            notes: [],
            executionStatus: ExecutionStatus.done,
            status: Status.failed,
          },
          stepsResult: [
            {
              data: {
                stepInfo: {
                  stepName: 'step1',
                },
                artifactStepResult: {
                  error: {
                    message: 'error123',
                  },
                  notes: [],
                  executionStatus: ExecutionStatus.done,
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
