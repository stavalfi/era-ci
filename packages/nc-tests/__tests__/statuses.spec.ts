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

test('passed,passed => passed', async () => {
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
      createStep({
        stepName: 'step2',
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
      {
        data: {
          stepInfo: {
            stepName: 'step2',
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
