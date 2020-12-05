import { createArtifactStepConstrain, createStep, RunStrategy } from '@tahini/core'
import { ExecutionStatus, Status, ConstrainResult } from '@tahini/utils'
import { JsonReport } from '@tahini/steps'
import { createTest, DeepPartial, isDeepSubsetOfOrPrint } from '@tahini/e2e-tests-infra'
import { LocalSequentalTaskQueue } from '@tahini/task-queues'
import { createLinearStepsGraph } from '@tahini/steps-graph'

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
          createStep({
            stepName: 'step1',
            taskQueueClass: LocalSequentalTaskQueue,
            constrains: {
              onArtifact: [
                createArtifactStepConstrain({
                  constrainName: 'test-constrain',
                  constrain: async () => ({
                    constrainResult: ConstrainResult.ignoreThisConstrain,
                    artifactStepResult: {
                      errors: [],
                      notes: [],
                    },
                  }),
                })(),
              ],
            },
            run: {
              runStrategy: RunStrategy.perArtifact,
              runStepOnArtifact: async () => {
                return { errors: [], notes: [], executionStatus: ExecutionStatus.done, status: Status.passed }
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

    expect(isDeepSubsetOfOrPrint(jsonReport, expectedJsonReport)).toBeTruthy()
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
          createStep({
            stepName: 'step1',
            taskQueueClass: LocalSequentalTaskQueue,
            constrains: {
              onArtifact: [
                createArtifactStepConstrain({
                  constrainName: 'test-constrain',
                  constrain: async () => ({
                    constrainResult: ConstrainResult.shouldSkip,
                    artifactStepResult: {
                      errors: [],
                      notes: [],
                      executionStatus: ExecutionStatus.aborted,
                      status: Status.skippedAsPassed,
                    },
                  }),
                })(),
              ],
            },
            run: {
              runStrategy: RunStrategy.perArtifact,
              runStepOnArtifact: async () => {
                // we will never be here
                return { errors: [], notes: [], executionStatus: ExecutionStatus.done, status: Status.failed }
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

    expect(isDeepSubsetOfOrPrint(jsonReport, expectedJsonReport)).toBeTruthy()
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
          createStep({
            stepName: 'step1',
            taskQueueClass: LocalSequentalTaskQueue,
            constrains: {
              onArtifact: [
                createArtifactStepConstrain({
                  constrainName: 'test-constrain',
                  constrain: async () => ({
                    constrainResult: ConstrainResult.shouldSkip,
                    artifactStepResult: {
                      errors: [],
                      notes: ['note1', 'note2'],
                      executionStatus: ExecutionStatus.aborted,
                      status: Status.skippedAsPassed,
                    },
                  }),
                })(),
              ],
            },
            run: {
              runStrategy: RunStrategy.perArtifact,
              runStepOnArtifact: async () => {
                // we will never be here
                return { errors: [], notes: [], executionStatus: ExecutionStatus.done, status: Status.failed }
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

    expect(isDeepSubsetOfOrPrint(jsonReport, expectedJsonReport)).toBeTruthy()
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
          createStep({
            stepName: 'step1',
            taskQueueClass: LocalSequentalTaskQueue,
            constrains: {
              onArtifact: [
                createArtifactStepConstrain({
                  constrainName: 'test-constrain',
                  constrain: async () => ({
                    constrainResult: ConstrainResult.shouldSkip,
                    artifactStepResult: {
                      errors: [],
                      notes: ['note1', 'note2', 'note1', 'note2'],
                      executionStatus: ExecutionStatus.aborted,
                      status: Status.skippedAsPassed,
                    },
                  }),
                })(),
              ],
            },
            run: {
              runStrategy: RunStrategy.perArtifact,
              runStepOnArtifact: async () => {
                // we will never be here
                return { errors: [], notes: [], executionStatus: ExecutionStatus.done, status: Status.failed }
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

    expect(isDeepSubsetOfOrPrint(jsonReport, expectedJsonReport)).toBeTruthy()
  })
})
