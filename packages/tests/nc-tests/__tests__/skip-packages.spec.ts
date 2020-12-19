import { ConstrainResultType, createConstrain, createStepExperimental } from '@tahini/core'
import { createTest, DeepPartial, isDeepSubset } from '@tahini/e2e-tests-infra'
import { JsonReport } from '@tahini/steps'
import { createLinearStepsGraph } from '@tahini/steps-graph'
import { LocalSequentalTaskQueue } from '@tahini/task-queues'
import { ExecutionStatus, Status } from '@tahini/utils'

const { createRepo } = createTest()

describe('define custom predicate to check if we need to run the step on a package', () => {
  test('return true and expect the step to run', async () => {
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
              artifactConstrains: [
                createConstrain({
                  constrainName: 'test-constrain',
                  constrain: async () => ({
                    resultType: ConstrainResultType.ignoreThisConstrain,
                    result: {
                      errors: [],
                      notes: [],
                    },
                  }),
                }),
              ],
              onArtifact: () => Promise.resolve(),
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
              executionStatus: ExecutionStatus.done,
              errors: [],
              notes: [],
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
                    executionStatus: ExecutionStatus.done,
                    errors: [],
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

    expect(isDeepSubset(jsonReport, expectedJsonReport)).toBeTruthy()
  })

  test('return false and expect the step not to run', async () => {
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
              artifactConstrains: [
                createConstrain({
                  constrainName: 'test-constrain',
                  constrain: async () => ({
                    resultType: ConstrainResultType.shouldSkip,
                    result: {
                      errors: [],
                      notes: [],
                      executionStatus: ExecutionStatus.aborted,
                      status: Status.skippedAsPassed,
                    },
                  }),
                }),
              ],
              onArtifact: async () => ({ executionStatus: ExecutionStatus.done, status: Status.failed }),
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
        executionStatus: ExecutionStatus.aborted,
        status: Status.skippedAsPassed,
      },
      stepsResultOfArtifactsByStep: [
        {
          data: {
            stepInfo: {
              stepName: 'step1',
            },
            stepResult: {
              executionStatus: ExecutionStatus.aborted,
              errors: [],
              notes: [],
              status: Status.skippedAsPassed,
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
                    executionStatus: ExecutionStatus.aborted,
                    errors: [],
                    notes: [],
                    status: Status.skippedAsPassed,
                  },
                },
              },
            ],
          },
        },
      ],
    }

    expect(isDeepSubset(jsonReport, expectedJsonReport)).toBeTruthy()
  })

  test('return false with notes and expect the step not to run with notes', async () => {
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
              artifactConstrains: [
                createConstrain({
                  constrainName: 'test-constrain',
                  constrain: async () => ({
                    resultType: ConstrainResultType.shouldSkip,
                    result: {
                      errors: [],
                      notes: ['note1', 'note2'],
                      executionStatus: ExecutionStatus.aborted,
                      status: Status.skippedAsPassed,
                    },
                  }),
                }),
              ],
              onArtifact: async () => ({ executionStatus: ExecutionStatus.done, status: Status.failed }),
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
        executionStatus: ExecutionStatus.aborted,
        status: Status.skippedAsPassed,
      },
      stepsResultOfArtifactsByStep: [
        {
          data: {
            stepInfo: {
              stepName: 'step1',
            },
            stepResult: {
              executionStatus: ExecutionStatus.aborted,
              errors: [],
              notes: [],
              status: Status.skippedAsPassed,
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
                    executionStatus: ExecutionStatus.aborted,
                    errors: [],
                    notes: ['note1', 'note2'],
                    status: Status.skippedAsPassed,
                  },
                },
              },
            ],
          },
        },
      ],
    }

    expect(isDeepSubset(jsonReport, expectedJsonReport)).toBeTruthy()
  })

  test('return false with duplicate notes and expect the step not to run with out duplicate notes', async () => {
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
              artifactConstrains: [
                createConstrain({
                  constrainName: 'test-constrain',
                  constrain: async () => ({
                    resultType: ConstrainResultType.shouldSkip,
                    result: {
                      errors: [],
                      notes: ['note1', 'note2', 'note1', 'note2'],
                      executionStatus: ExecutionStatus.aborted,
                      status: Status.skippedAsPassed,
                    },
                  }),
                }),
              ],
              onArtifact: async () => ({ executionStatus: ExecutionStatus.done, status: Status.failed }),
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
        status: Status.skippedAsPassed,
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
              executionStatus: ExecutionStatus.aborted,
              status: Status.skippedAsPassed,
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
                    notes: ['note1', 'note2'],
                    executionStatus: ExecutionStatus.aborted,
                    status: Status.skippedAsPassed,
                  },
                },
              },
            ],
          },
        },
      ],
    }

    expect(isDeepSubset(jsonReport, expectedJsonReport)).toBeTruthy()
  })
})

it('reproduce bug - flow hangs when constrain allow package to run but artifact eventually aborted as passed', async () => {
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
          run: () => ({
            globalConstrains: [
              createConstrain({
                constrainName: 'test-constrain',
                constrain: async () => ({
                  resultType: ConstrainResultType.ignoreThisConstrain,
                  result: {
                    errors: [],
                    notes: [],
                  },
                }),
              })(),
            ],
            onArtifact: async () => {
              return { executionStatus: ExecutionStatus.aborted, status: Status.skippedAsPassed }
            },
          }),
        })(),
      ]),
    },
  })
  const { jsonReport } = await runCi()

  const expectedJsonReport: DeepPartial<JsonReport> = {
    flowResult: {
      executionStatus: ExecutionStatus.aborted,
      status: Status.skippedAsPassed,
    },
  }

  expect(isDeepSubset(jsonReport, expectedJsonReport)).toBeTruthy()
})

it('constrain allow package to run but artifact eventually aborted as failed', async () => {
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
          run: () => ({
            globalConstrains: [
              createConstrain({
                constrainName: 'test-constrain',
                constrain: async () => ({
                  resultType: ConstrainResultType.ignoreThisConstrain,
                  result: {
                    errors: [],
                    notes: [],
                  },
                }),
              })(),
            ],
            onArtifact: async () => {
              return { executionStatus: ExecutionStatus.aborted, status: Status.skippedAsFailed }
            },
          }),
        })(),
      ]),
    },
  })
  const { jsonReport } = await runCi()

  const expectedJsonReport: DeepPartial<JsonReport> = {
    flowResult: {
      executionStatus: ExecutionStatus.aborted,
      status: Status.skippedAsFailed,
    },
  }

  expect(isDeepSubset(jsonReport, expectedJsonReport)).toBeTruthy()
})
