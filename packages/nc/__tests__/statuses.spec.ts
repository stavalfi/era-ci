import { createStep, ExecutionStatus, JsonReport, Status } from '../src'
import { createTest, DeepPartial, isDeepSubsetOfOrPrint } from './prepare-tests'

const { createRepo } = createTest()

test('skippedAsPassed,passed => passed', async () => {
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
            status: Status.skippedAsPassed,
          }
        },
      })(),
      createStep({
        stepName: 'step2',
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
      {
        data: {
          stepInfo: {
            stepName: 'step2',
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
