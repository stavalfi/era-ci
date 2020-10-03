import { createStep, ExecutionStatus, JsonReport, Status } from '../src'
import { createTest, DeepPartial, isDeepSubsetOfOrPrint } from './prepare-tests'

const { createRepo } = createTest()

describe('define custom predicate to check if we need to run the step on a package', () => {
  test('return true and expect the step to run', async () => {
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
          canRunStepOnArtifact: {
            customPredicate: async () => {
              return true
            },
          },
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

  test('return false and expect the step not to run', async () => {
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
          canRunStepOnArtifact: {
            customPredicate: async () => {
              return {
                canRun: false,
                notes: [],
                stepStatus: Status.skippedAsPassed,
              }
            },
          },
          runStepOnArtifact: async () => {
            // we will never be here
            return {
              notes: [],
              status: Status.failed,
            }
          },
        })(),
      ],
    })

    const expectedJsonReport: DeepPartial<JsonReport> = {
      flowResult: {
        error: undefined,
        notes: [],
        status: Status.skippedAsPassed,
      },
      stepsResultOfArtifactsByStep: [
        {
          data: {
            stepInfo: {
              stepName: 'step1',
            },
            stepExecutionStatus: ExecutionStatus.aborted,
            stepResult: {
              error: undefined,
              notes: [],
              status: Status.skippedAsPassed,
            },
            artifactsResult: [
              {
                data: {
                  artifactStepExecutionStatus: ExecutionStatus.aborted,
                  artifact: {
                    packageJson: {
                      name: toActualName('a'),
                    },
                  },
                  artifactStepResult: {
                    error: undefined,
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
          canRunStepOnArtifact: {
            customPredicate: async () => {
              return {
                canRun: false,
                notes: ['note1', 'note2'],
                stepStatus: Status.skippedAsPassed,
              }
            },
          },
          runStepOnArtifact: async () => {
            // we will never be here
            return {
              notes: [],
              status: Status.failed,
            }
          },
        })(),
      ],
    })

    const expectedJsonReport: DeepPartial<JsonReport> = {
      flowResult: {
        error: undefined,
        notes: [],
        status: Status.skippedAsPassed,
      },
      stepsResultOfArtifactsByStep: [
        {
          data: {
            stepInfo: {
              stepName: 'step1',
            },
            stepExecutionStatus: ExecutionStatus.aborted,
            stepResult: {
              error: undefined,
              notes: [],
              status: Status.skippedAsPassed,
            },
            artifactsResult: [
              {
                data: {
                  artifactStepExecutionStatus: ExecutionStatus.aborted,
                  artifact: {
                    packageJson: {
                      name: toActualName('a'),
                    },
                  },
                  artifactStepResult: {
                    error: undefined,
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
          canRunStepOnArtifact: {
            customPredicate: async () => {
              return {
                canRun: false,
                notes: ['note1', 'note2', 'note1', 'note2'],
                stepStatus: Status.skippedAsPassed,
              }
            },
          },
          runStepOnArtifact: async () => {
            // we will never be here
            return {
              notes: [],
              status: Status.failed,
            }
          },
        })(),
      ],
    })

    const expectedJsonReport: DeepPartial<JsonReport> = {
      flowResult: {
        error: undefined,
        notes: [],
        status: Status.skippedAsPassed,
      },
      stepsResultOfArtifactsByStep: [
        {
          data: {
            stepInfo: {
              stepName: 'step1',
            },
            stepExecutionStatus: ExecutionStatus.aborted,
            stepResult: {
              error: undefined,
              notes: [],
              status: Status.skippedAsPassed,
            },
            artifactsResult: [
              {
                data: {
                  artifactStepExecutionStatus: ExecutionStatus.aborted,
                  artifact: {
                    packageJson: {
                      name: toActualName('a'),
                    },
                  },
                  artifactStepResult: {
                    error: undefined,
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
})
