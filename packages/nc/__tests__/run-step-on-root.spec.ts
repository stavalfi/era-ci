import { createStep, ExecutionStatus, JsonReport, localSequentalTaskQueue, RunStrategy, Status } from '../src'
import { createTest, DeepPartial, isDeepSubsetOfOrPrint } from './prepare-tests'

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
  const { passed, jsonReport, flowId } = await runCi({
    steps: [
      createStep({
        stepName: 'step1',
        configureTaskQueue: localSequentalTaskQueue,
        run: {
          runStrategy: RunStrategy.root,
          runStepOnRoot: async () => {
            return { errors: [], notes: [], executionStatus: ExecutionStatus.done, status: Status.passed }
          },
        },
      })(),
    ],
  })

  expect(passed).toBeTruthy()

  const expectedJsonReport: DeepPartial<JsonReport> = {
    flow: {
      flowId,
    },
    flowResult: {
      errors: [],
      notes: [],
      status: Status.passed,
    },
  }

  expect(isDeepSubsetOfOrPrint(jsonReport, expectedJsonReport)).toBeTruthy()
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
        configureTaskQueue: localSequentalTaskQueue,
        run: {
          runStrategy: RunStrategy.root,
          runStepOnRoot: async () => {
            return { errors: [], notes: [], executionStatus: ExecutionStatus.done, status: Status.passed }
          },
        },
      })(),
    ],
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
        configureTaskQueue: localSequentalTaskQueue,
        run: {
          runStrategy: RunStrategy.root,
          runStepOnRoot: async () => {
            return { errors: [], notes: [], executionStatus: ExecutionStatus.done, status: Status.failed }
          },
        },
      })(),
    ],
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
            executionStatus: ExecutionStatus.done,
            notes: [],
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
        configureTaskQueue: localSequentalTaskQueue,
        run: {
          runStrategy: RunStrategy.root,
          runStepOnRoot: async () => {
            throw new Error('error123')
          },
        },
      })(),
    ],
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
            errors: [
              {
                message: 'error123',
              },
            ],
            executionStatus: ExecutionStatus.done,
            notes: [],
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
  }

  expect(isDeepSubsetOfOrPrint(jsonReport, expectedJsonReport)).toBeTruthy()
})
