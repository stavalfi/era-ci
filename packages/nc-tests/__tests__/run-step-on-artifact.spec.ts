import {
  createLinearStepsGraph,
  createStep,
  ExecutionStatus,
  JsonReport,
  LocalSequentalTaskQueue,
  RunStrategy,
  Status,
} from '@tahini/nc'
import { createTest, DeepPartial, isDeepSubsetOfOrPrint } from '@tahini/e2e-tests-infra'

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
    steps: createLinearStepsGraph([
      createStep({
        stepName: 'step1',
        taskQueueClass: LocalSequentalTaskQueue,
        run: {
          runStrategy: RunStrategy.perArtifact,
          runStepOnArtifact: async () => {
            return { errors: [], notes: [], executionStatus: ExecutionStatus.done, status: Status.passed }
          },
        },
      })(),
    ]),
  })

  const expectedJsonReport: DeepPartial<JsonReport> = {
    flowResult: {
      errors: [],
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
            errors: [],
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
                  errors: [],
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
            errors: [],
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
                  errors: [],
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
    steps: createLinearStepsGraph([
      createStep({
        stepName: 'step1',
        taskQueueClass: LocalSequentalTaskQueue,
        run: {
          runStrategy: RunStrategy.perArtifact,
          runStepOnArtifact: async () => {
            return { errors: [], notes: [], executionStatus: ExecutionStatus.done, status: Status.failed }
          },
        },
      })(),
    ]),
  })

  expect(passed).toBeFalsy()

  const expectedJsonReport: DeepPartial<JsonReport> = {
    flowResult: {
      errors: [],
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
            errors: [],
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
                  errors: [],
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
            errors: [],
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
                  errors: [],
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
    steps: createLinearStepsGraph([
      createStep({
        stepName: 'step1',
        taskQueueClass: LocalSequentalTaskQueue,
        run: {
          runStrategy: RunStrategy.perArtifact,
          runStepOnArtifact: async () => {
            throw new Error('error123')
          },
        },
      })(),
    ]),
  })

  expect(passed).toBeFalsy()

  const expectedJsonReport: DeepPartial<JsonReport> = {
    flowExecutionStatus: ExecutionStatus.done,
    flowResult: {
      errors: [],
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
            errors: [],
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
                  errors: [
                    {
                      message: 'error123',
                    },
                  ],
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
            errors: [],
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
                  errors: [
                    {
                      message: 'error123',
                    },
                  ],
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
