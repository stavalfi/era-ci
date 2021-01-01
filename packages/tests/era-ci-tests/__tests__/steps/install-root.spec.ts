import { createTest, DeepPartial, isDeepSubset } from '@era-ci/e2e-tests-infra'
import { installRoot, JsonReport, validatePackages } from '@era-ci/steps'
import { createLinearStepsGraph } from '@era-ci/steps-graph'
import { ExecutionStatus, Status } from '@era-ci/utils'

const { createRepo } = createTest()

it('install-step should pass', async () => {
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
      steps: createLinearStepsGraph([validatePackages(), installRoot()]),
    },
  })
  const { jsonReport } = await runCi()

  const expectedJsonReport: DeepPartial<JsonReport> = {
    flowResult: {
      executionStatus: ExecutionStatus.done,
      status: Status.passed,
    },
  }

  expect(isDeepSubset(jsonReport, expectedJsonReport)).toBeTruthy()
})

it('install-step should abort-as-failed because it depends on other step which is not defined: validatePackages', async () => {
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
      steps: createLinearStepsGraph([installRoot()]),
    },
  })
  const { jsonReport } = await runCi()

  const expectedJsonReport: DeepPartial<JsonReport> = {
    flowResult: {
      errors: [],
      notes: [],
      executionStatus: ExecutionStatus.aborted,
      status: Status.skippedAsFailed,
    },
    stepsResultOfArtifactsByStep: [
      {
        data: {
          stepExecutionStatus: ExecutionStatus.aborted,
          stepInfo: {
            stepName: 'install-root',
          },
          stepResult: {
            executionStatus: ExecutionStatus.aborted,
            status: Status.skippedAsFailed,
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
                  status: Status.skippedAsFailed,
                  errors: [],
                  notes: [],
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
