import { createStepExperimental } from '@tahini/core'
import { createTest, DeepPartial, isDeepSubsetOfOrPrint } from '@tahini/e2e-tests-infra'
import { JsonReport } from '@tahini/steps'
import { createLinearStepsGraph } from '@tahini/steps-graph'
import { LocalSequentalTaskQueue } from '@tahini/task-queues'
import { ExecutionStatus, Status } from '@tahini/utils'

const { createRepo } = createTest()

test('flow should pass because step pass', async () => {
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
      steps: createLinearStepsGraph([
        createStepExperimental({
          stepName: 'step1',
          taskQueueClass: LocalSequentalTaskQueue,
          run: () => ({ stepLogic: () => Promise.resolve() }),
        })(),
      ]),
    },
  })
  const { passed, jsonReport, flowId } = await runCi()

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
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
        },
      ],
    },
    configurations: {
      steps: createLinearStepsGraph([
        createStepExperimental({
          stepName: 'step1',
          taskQueueClass: LocalSequentalTaskQueue,
          run: () => ({ stepLogic: () => Promise.resolve() }),
        })(),
      ]),
    },
  })
  const { jsonReport } = await runCi()

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
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
        },
      ],
    },
    configurations: {
      steps: createLinearStepsGraph([
        createStepExperimental({
          stepName: 'step1',
          taskQueueClass: LocalSequentalTaskQueue,
          run: () => ({
            stepLogic: async () => ({
              executionStatus: ExecutionStatus.done,
              status: Status.failed,
            }),
          }),
        })(),
      ]),
    },
  })
  const { passed, jsonReport } = await runCi()

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
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
        },
      ],
    },
    configurations: {
      steps: createLinearStepsGraph([
        createStepExperimental({
          stepName: 'step1',
          taskQueueClass: LocalSequentalTaskQueue,
          run: () => ({
            stepLogic: async () => {
              throw new Error('error123')
            },
          }),
        })(),
      ]),
    },
  })
  const { passed, jsonReport } = await runCi()

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
