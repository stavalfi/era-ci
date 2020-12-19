import { createStepExperimental } from '@tahini/core'
import { createTest, DeepPartial, isDeepSubset } from '@tahini/e2e-tests-infra'
import { JsonReport, npmPublish, NpmScopeAccess } from '@tahini/steps'
import { createLinearStepsGraph } from '@tahini/steps-graph'
import { LocalSequentalTaskQueue } from '@tahini/task-queues'
import { ExecutionStatus, Status } from '@tahini/utils'

const { createRepo } = createTest()

it('reproduce bug - wrong step statuses', async () => {
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
            onArtifact: async () => {
              return { executionStatus: ExecutionStatus.done, status: Status.passed }
            },
          }),
        })(),
        npmPublish({
          isStepEnabled: false,
          npmScopeAccess: NpmScopeAccess.public,
          registry: 'wont-be-used',
          publishAuth: {
            email: '',
            token: '',
            username: '',
          },
        }),
      ]),
    },
  })
  const { jsonReport } = await runCi()

  const expectedJsonReport: DeepPartial<JsonReport> = {
    flowResult: {
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
            stepName: 'npm-publish',
          },
          stepResult: {
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
