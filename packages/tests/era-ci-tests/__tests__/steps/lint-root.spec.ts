import { createTest, isDeepSubset } from '@era-ci/e2e-tests-infra'
import { lintRoot } from '@era-ci/steps'
import { createLinearStepsGraph } from '@era-ci/steps-graph'
import { ExecutionStatus, Status } from '@era-ci/utils'

const { createRepo } = createTest()

it('ensure lint-root runs', async () => {
  const { runCi } = await createRepo({
    repo: {
      rootPackageJson: {
        scripts: {
          lint: 'echo hi123',
        },
      },
      packages: [
        {
          name: 'a',
          version: '1.0.0',
        },
      ],
    },
    configurations: {
      steps: createLinearStepsGraph([lintRoot({ scriptName: 'lint' })]),
    },
  })

  const { flowLogs } = await runCi()

  expect(flowLogs).toEqual(expect.stringContaining('hi123'))
})

it('ensure lint-root pass successfully', async () => {
  const { runCi } = await createRepo({
    repo: {
      rootPackageJson: {
        scripts: {
          lint: 'echo hi123',
        },
      },
      packages: [
        {
          name: 'a',
          version: '1.0.0',
        },
      ],
    },
    configurations: {
      steps: createLinearStepsGraph([lintRoot({ scriptName: 'lint' })]),
    },
  })

  const { jsonReport } = await runCi()

  expect(
    isDeepSubset(jsonReport, {
      flowResult: {
        executionStatus: ExecutionStatus.done,
        status: Status.passed,
      },
      stepsResultOfArtifactsByStep: [
        {
          data: {
            stepResult: {
              executionStatus: ExecutionStatus.done,
              status: Status.passed,
            },
            artifactsResult: [
              {
                data: {
                  artifactStepResult: {
                    executionStatus: ExecutionStatus.done,
                    status: Status.passed,
                  },
                },
              },
            ],
          },
        },
      ],
    }),
  ).toBeTruthy()
})

it('ensure lint-root skipped-as-passed in second run (when there are no changes in the repo)', async () => {
  const { runCi } = await createRepo({
    repo: {
      rootPackageJson: {
        scripts: {
          lint: 'echo hi123',
        },
      },
      packages: [
        {
          name: 'a',
          version: '1.0.0',
        },
      ],
    },
    configurations: {
      steps: createLinearStepsGraph([lintRoot({ scriptName: 'lint' })]),
    },
  })

  await runCi()

  const { jsonReport } = await runCi()

  expect(
    isDeepSubset(jsonReport, {
      flowResult: {
        executionStatus: ExecutionStatus.aborted,
        status: Status.skippedAsPassed,
      },
      stepsResultOfArtifactsByStep: [
        {
          data: {
            stepResult: {
              executionStatus: ExecutionStatus.aborted,
              status: Status.skippedAsPassed,
            },
            artifactsResult: [
              {
                data: {
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
    }),
  ).toBeTruthy()
})
