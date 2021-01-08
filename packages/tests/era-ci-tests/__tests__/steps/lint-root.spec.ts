import { createTest, isDeepSubset } from '@era-ci/e2e-tests-infra'
import { lintRoot } from '@era-ci/steps'
import { createLinearStepsGraph } from '@era-ci/steps-graph'
import { ExecutionStatus, Status } from '@era-ci/utils'
import fs from 'fs'
import path from 'path'

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

it('reproduce bug - lint-root should run if hash of one of the packages change', async () => {
  const { runCi, repoPath, toActualName } = await createRepo({
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
          additionalFiles: {
            file1: '',
          },
        },
      ],
    },
    configurations: {
      steps: createLinearStepsGraph([lintRoot({ scriptName: 'lint' })]),
    },
  })

  await runCi() // should run because its the first run

  await runCi() // should skip because all the hashes are the same

  await fs.promises.writeFile(path.join(repoPath, 'packages', toActualName('a'), 'file1'), 'hi', 'utf-8')

  const { jsonReport } = await runCi() // should run because the hash of one of the packages changed.

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
