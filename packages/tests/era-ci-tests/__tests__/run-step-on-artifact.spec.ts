import { createStepExperimental } from '@era-ci/core'
import { createRepo, createTest, DeepPartial, isDeepSubset, test } from '@era-ci/e2e-tests-infra'
import { JsonReport } from '@era-ci/steps'
import { createLinearStepsGraph } from '@era-ci/steps-graph'
import { LocalSequentalTaskQueue } from '@era-ci/task-queues'
import { ExecutionStatus, Status } from '@era-ci/utils'
import expect from 'expect'

createTest(test)

test('step should pass in json-report', async t => {
  const { runCi, toActualName } = await createRepo(t, {
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
          stepGroup: 'step1',
          taskQueueClass: LocalSequentalTaskQueue,
          run: () => ({
            onArtifact: async () => {
              return { executionStatus: ExecutionStatus.done, status: Status.passed }
            },
          }),
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

  expect(isDeepSubset(t, jsonReport, expectedJsonReport)).toBeTruthy()
})

test('flow should fail because step failed (without throwing error from the step)', async t => {
  const { runCi, toActualName } = await createRepo(t, {
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
          stepGroup: 'step1',
          taskQueueClass: LocalSequentalTaskQueue,
          run: () => ({
            onArtifact: async () => {
              return { executionStatus: ExecutionStatus.done, status: Status.failed }
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

  expect(isDeepSubset(t, jsonReport, expectedJsonReport)).toBeTruthy()
})

test('flow should fail because step failed (while throwing error from the step)', async t => {
  const { runCi, toActualName } = await createRepo(t, {
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
          stepGroup: 'step1',
          taskQueueClass: LocalSequentalTaskQueue,
          run: () => ({
            onArtifact: async () => {
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

  expect(isDeepSubset(t, jsonReport, expectedJsonReport)).toBeTruthy()
})
