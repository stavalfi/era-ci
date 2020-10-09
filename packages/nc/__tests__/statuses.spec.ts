import { createStep, ExecutionStatus, JsonReport, Status } from '../src'
import { createTest, DeepPartial, isDeepSubsetOfOrPrint } from './prepare-tests'

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
      createStep({
        stepName: 'step2',
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
      {
        data: {
          stepInfo: {
            stepName: 'step2',
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
  }

  expect(isDeepSubsetOfOrPrint(jsonReport, expectedJsonReport)).toBeTruthy()
})
