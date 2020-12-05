import { createStep, RunStrategy, UserStepResult } from '@tahini/core'
import { ExecutionStatus, Status } from '@tahini/utils'
import { JsonReport } from '@tahini/steps'
import { createTest, DeepPartial, isDeepSubsetOfOrPrint } from '@tahini/e2e-tests-infra'
import { LocalSequentalTaskQueue } from '@tahini/task-queues'
import { createLinearStepsGraph } from '@tahini/steps-graph'

const { createRepo } = createTest()

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
        createStep({
          stepName: 'step1',
          taskQueueClass: LocalSequentalTaskQueue,
          run: {
            runStrategy: RunStrategy.allArtifacts,
            runStepOnArtifacts: async (): Promise<UserStepResult> => {
              return {
                stepResult: {
                  errors: [],
                  notes: [],
                },
                artifactsResult: [
                  {
                    artifactName: toActualName('a'),
                    artifactStepResult: {
                      durationMs: 1,
                      errors: [],
                      notes: [],
                      executionStatus: ExecutionStatus.done,
                      status: Status.passed,
                    },
                  },
                ],
              }
            },
          },
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
        createStep({
          stepName: 'step1',
          taskQueueClass: LocalSequentalTaskQueue,
          run: {
            runStrategy: RunStrategy.allArtifacts,
            runStepOnArtifacts: async (): Promise<UserStepResult> => {
              return {
                stepResult: {
                  errors: [],
                  notes: [],
                },
                artifactsResult: [
                  {
                    artifactName: toActualName('a'),
                    artifactStepResult: {
                      durationMs: 1,
                      errors: [],
                      notes: [],
                      executionStatus: ExecutionStatus.done,
                      status: Status.failed,
                    },
                  },
                ],
              }
            },
          },
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
        createStep({
          stepName: 'step1',
          taskQueueClass: LocalSequentalTaskQueue,
          run: {
            runStrategy: RunStrategy.allArtifacts,
            runStepOnArtifacts: async () => {
              throw new Error('error123')
            },
          },
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
  }

  expect(isDeepSubsetOfOrPrint(jsonReport, expectedJsonReport)).toBeTruthy()
})
