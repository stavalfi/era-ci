import { createRepo, createTest, isDeepSubset, test } from '@era-ci/e2e-tests-infra'
import { lintRoot } from '@era-ci/steps'
import { createLinearStepsGraph } from '@era-ci/steps-graph'
import { taskWorkerTaskQueue } from '@era-ci/task-queues'
import { ExecutionStatus, Status } from '@era-ci/utils'
import chance from 'chance'
import expect from 'expect'
import fs from 'fs'
import path from 'path'

createTest(test)

test('ensure lint-root runs', async t => {
  const { runCi } = await createRepo(t, {
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
      taskQueues: [
        taskWorkerTaskQueue({
          queueName: `queue-${chance().hash().slice(0, 8)}`,
          redis: {
            url: t.context.resources.redisServerUrl,
          },
        }),
      ],
      steps: createLinearStepsGraph([lintRoot({ scriptName: 'lint' })]),
    },
  })

  const { flowLogs } = await runCi()

  expect(flowLogs).toEqual(expect.stringContaining('hi123'))
})

test('ensure lint-root pass successfully', async t => {
  const { runCi } = await createRepo(t, {
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
      taskQueues: [
        taskWorkerTaskQueue({
          queueName: `queue-${chance().hash().slice(0, 8)}`,
          redis: {
            url: t.context.resources.redisServerUrl,
          },
        }),
      ],
      steps: createLinearStepsGraph([lintRoot({ scriptName: 'lint' })]),
    },
  })

  const { jsonReport } = await runCi()

  expect(
    isDeepSubset(t,jsonReport, {
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

test('ensure lint-root skipped-as-passed in second run (when there are no changes in the repo)', async t => {
  const { runCi } = await createRepo(t, {
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
      taskQueues: [
        taskWorkerTaskQueue({
          queueName: `queue-${chance().hash().slice(0, 8)}`,
          redis: {
            url: t.context.resources.redisServerUrl,
          },
        }),
      ],
      steps: createLinearStepsGraph([lintRoot({ scriptName: 'lint' })]),
    },
  })

  await runCi()

  const { jsonReport } = await runCi()

  expect(
    isDeepSubset(t,jsonReport, {
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

test('reproduce bug - lint-root should run if hash of one of the packages change', async t => {
  const { runCi, repoPath, toActualName } = await createRepo(t, {
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
      taskQueues: [
        taskWorkerTaskQueue({
          queueName: `queue-${chance().hash().slice(0, 8)}`,
          redis: {
            url: t.context.resources.redisServerUrl,
          },
        }),
      ],
      steps: createLinearStepsGraph([lintRoot({ scriptName: 'lint' })]),
    },
  })

  await runCi() // should run because its the first run

  await runCi() // should skip because all the hashes are the same

  await fs.promises.writeFile(path.join(repoPath, 'packages', toActualName('a'), 'file1'), 'hi', 'utf-8')

  const { jsonReport } = await runCi() // should run because the hash of one of the packages changed.

  expect(
    isDeepSubset(t,jsonReport, {
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
