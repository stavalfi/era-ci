import { createTest } from '@era-ci/e2e-tests-infra'
import { test as testStep } from '@era-ci/steps'
import { createLinearStepsGraph } from '@era-ci/steps-graph'
import { taskWorkerTaskQueue } from '@era-ci/task-queues'
import { startWorker } from '@era-ci/task-worker'
import chance from 'chance'
import expect from 'expect'
import fs from 'fs'
import _ from 'lodash'
import path from 'path'

const { createRepo, getCleanups, getProcessEnv, getResources, createTestLogger } = createTest()

test('single worker - glob does not find any test file - should print helpful note to the user about that', async () => {
  const queueName = `queue-${chance().hash().slice(0, 8)}`
  const { runCi } = await createRepo({
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          scripts: {
            test: `exit 1 # "we can not be here"`,
          },
          tests: {
            'lalalala.exec': '',
          },
        },
      ],
    },
    configurations: {
      taskQueues: [
        taskWorkerTaskQueue({
          queueName,
          redis: {
            url: getResources().redisServerUrl,
          },
        }),
      ],
      steps: createLinearStepsGraph([
        testStep({
          isStepEnabled: true,
          scriptName: 'test',
          splitTestsToMultipleVms: {
            totalWorkers: 1,
            relativeGlobToSearchTestFiles: 'tests/*.spec.js',
            startIndexingFromZero: true,
            env: {
              indexKeyEnvName: 'INDEX_KEY_NAME',
              totalVmsEnvKeyName: 'TOTAL_KEY_NAME',
            },
          },
        }),
      ]),
    },
  })

  const { flowLogs, passed } = await runCi()

  expect(passed).toBeTruthy()
  expect(flowLogs).toEqual(expect.stringContaining(`could not find any test file using glob: "tests/*.spec.js"`))
})

test('single worker - single task', async () => {
  const queueName = `queue-${chance().hash().slice(0, 8)}`
  const { runCi } = await createRepo({
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          scripts: {
            test: `echo total=$TOTAL_KEY_NAME, index=$INDEX_KEY_NAME`, // the test files will be added to the end of this line
          },
          tests: {
            'test1.spec.js': '',
            'test2.spec.js': '',
          },
        },
      ],
    },
    configurations: {
      taskQueues: [
        taskWorkerTaskQueue({
          queueName,
          redis: {
            url: getResources().redisServerUrl,
          },
        }),
      ],
      steps: createLinearStepsGraph([
        testStep({
          isStepEnabled: true,
          scriptName: 'test',
          splitTestsToMultipleVms: {
            totalWorkers: 1,
            relativeGlobToSearchTestFiles: 'tests/*.spec.js',
            startIndexingFromZero: true,
            env: {
              indexKeyEnvName: 'INDEX_KEY_NAME',
              totalVmsEnvKeyName: 'TOTAL_KEY_NAME',
            },
          },
        }),
      ]),
    },
  })

  const { flowLogs, jsonReport } = await runCi()

  expect(flowLogs).toEqual(
    expect.stringContaining(
      `total=1, index=0 ${path.join(
        jsonReport.artifacts[0].data.artifact.packagePath,
        'tests/test1.spec.js',
      )} ${path.join(jsonReport.artifacts[0].data.artifact.packagePath, 'tests/test2.spec.js')}`,
    ),
  )
})

test('splitTestsToMultipleVms.startIndexingFromZero=false - single worker - single task', async () => {
  const queueName = `queue-${chance().hash().slice(0, 8)}`
  const { runCi } = await createRepo({
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          scripts: {
            test: `echo "total=$TOTAL_KEY_NAME, index=$INDEX_KEY_NAME"`,
          },
          tests: {
            'test1.spec.js': '',
          },
        },
      ],
    },
    configurations: {
      taskQueues: [
        taskWorkerTaskQueue({
          queueName,
          redis: {
            url: getResources().redisServerUrl,
          },
        }),
      ],
      steps: createLinearStepsGraph([
        testStep({
          isStepEnabled: true,
          scriptName: 'test',
          splitTestsToMultipleVms: {
            totalWorkers: 1,
            relativeGlobToSearchTestFiles: 'tests/*.spec.js',
            startIndexingFromZero: false,
            env: {
              indexKeyEnvName: 'INDEX_KEY_NAME',
              totalVmsEnvKeyName: 'TOTAL_KEY_NAME',
            },
          },
        }),
      ]),
    },
  })

  const { flowLogs } = await runCi()

  expect(flowLogs).toEqual(expect.stringContaining(`total=1, index=1`))
})

test('two workers - single task - two workers should execute the task but with different enviroment variables', async () => {
  const queueName = `queue-${chance().hash().slice(0, 8)}`
  const { runCi, repoPath } = await createRepo({
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          scripts: {
            test: `echo "total=$TOTAL_KEY_NAME, index=$INDEX_KEY_NAME"`,
          },
          tests: {
            'test1.spec.js': '',
            'test2.spec.js': '',
          },
        },
      ],
    },
    configurations: {
      taskQueues: [
        taskWorkerTaskQueue({
          queueName,
          redis: {
            url: getResources().redisServerUrl,
          },
        }),
      ],
      steps: createLinearStepsGraph([
        testStep({
          isStepEnabled: true,
          scriptName: 'test',
          splitTestsToMultipleVms: {
            totalWorkers: 2,
            relativeGlobToSearchTestFiles: 'tests/*.spec.js',
            startIndexingFromZero: true,
            env: {
              indexKeyEnvName: 'INDEX_KEY_NAME',
              totalVmsEnvKeyName: 'TOTAL_KEY_NAME',
            },
          },
        }),
      ]),
    },
  })

  const worker2 = await startWorker({
    config: {
      queueName,
      redis: {
        url: getResources().redisServerUrl,
      },
      repoPath,
      maxWaitMsUntilFirstTask: 10_000,
      maxWaitMsWithoutTasks: 10_000,
    },
    processEnv: getProcessEnv(),
    logger: await createTestLogger(repoPath),
  })
  getCleanups().push(worker2.cleanup)

  const { flowLogs } = await runCi()
  const workerLogs = await fs.promises.readFile(worker2.logFilePath, 'utf-8')
  const combinedLogs = `${flowLogs}${workerLogs}`

  expect(combinedLogs).toEqual(expect.stringContaining(`total=2, index=0`))
  expect(combinedLogs).toEqual(expect.stringContaining(`total=2, index=1`))
})

test('1 + 5 workers - single task - all workers should execute the task but with different enviroment variables', async () => {
  const queueName = `queue-${chance().hash().slice(0, 8)}`
  const { runCi, repoPath } = await createRepo({
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          scripts: {
            test: `echo "total=$TOTAL_KEY_NAME, index=$INDEX_KEY_NAME"`,
          },
          tests: {
            'test1.spec.js': '',
            'test2.spec.js': '',
            'test3.spec.js': '',
            'test4.spec.js': '',
            'test5.spec.js': '',
            'test6.spec.js': '',
          },
        },
      ],
    },
    configurations: {
      taskQueues: [
        taskWorkerTaskQueue({
          queueName,
          redis: {
            url: getResources().redisServerUrl,
          },
        }),
      ],
      steps: createLinearStepsGraph([
        testStep({
          isStepEnabled: true,
          scriptName: 'test',
          splitTestsToMultipleVms: {
            totalWorkers: 6,
            relativeGlobToSearchTestFiles: 'tests/*.spec.js',
            startIndexingFromZero: true,
            env: {
              indexKeyEnvName: 'INDEX_KEY_NAME',
              totalVmsEnvKeyName: 'TOTAL_KEY_NAME',
            },
          },
        }),
      ]),
    },
  })

  const workers = await Promise.all(
    _.range(0, 5).map(async () =>
      startWorker({
        config: {
          queueName,
          redis: {
            url: getResources().redisServerUrl,
          },
          repoPath,
          maxWaitMsUntilFirstTask: 3_000,
          maxWaitMsWithoutTasks: 10_000,
        },
        processEnv: getProcessEnv(),
        logger: await createTestLogger(repoPath),
      }),
    ),
  )
  getCleanups().push(() => Promise.all(workers.map(worker => worker.cleanup())))

  const { flowLogs } = await runCi()
  const workersLogs = [
    flowLogs,
    ...(await Promise.all(workers.map(worker => fs.promises.readFile(worker.logFilePath, 'utf-8')))),
  ]

  const amountOfSubTasks = workersLogs.length

  for (const workerLog of workersLogs) {
    const isExecutedAnySubTask = _.range(0, amountOfSubTasks).some(i =>
      workerLog.includes(`total=${workers.length + 1}, index=${i}`),
    )
    expect(isExecutedAnySubTask).toBeTruthy()
  }
})

test('1 + 5 workers - long single task - all workers are expected to run a sub-task', async () => {
  const queueName = `queue-${chance().hash().slice(0, 8)}`
  const { runCi, repoPath } = await createRepo({
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          scripts: {
            test: `sleep 3 && echo "total=$TOTAL_KEY_NAME, index=$INDEX_KEY_NAME"`,
          },
          tests: {
            'test1.spec.js': '',
            'test2.spec.js': '',
            'test3.spec.js': '',
            'test4.spec.js': '',
            'test5.spec.js': '',
            'test6.spec.js': '',
          },
        },
      ],
    },
    configurations: {
      taskQueues: [
        taskWorkerTaskQueue({
          queueName,
          redis: {
            url: getResources().redisServerUrl,
          },
        }),
      ],
      steps: createLinearStepsGraph([
        testStep({
          isStepEnabled: true,
          scriptName: 'test',
          splitTestsToMultipleVms: {
            totalWorkers: 6,
            relativeGlobToSearchTestFiles: 'tests/*.spec.js',
            startIndexingFromZero: true,
            env: {
              indexKeyEnvName: 'INDEX_KEY_NAME',
              totalVmsEnvKeyName: 'TOTAL_KEY_NAME',
            },
          },
        }),
      ]),
    },
  })

  const workers = await Promise.all(
    _.range(0, 5).map(async () =>
      startWorker({
        config: {
          queueName,
          redis: {
            url: getResources().redisServerUrl,
          },
          repoPath,
          maxWaitMsUntilFirstTask: 10_000,
          maxWaitMsWithoutTasks: 10_000,
        },
        processEnv: getProcessEnv(),
        logger: await createTestLogger(repoPath),
      }),
    ),
  )
  getCleanups().push(() => Promise.all(workers.map(worker => worker.cleanup())))

  const { flowLogs } = await runCi()
  const workersLogs = [
    flowLogs,
    ...(await Promise.all(workers.map(worker => fs.promises.readFile(worker.logFilePath, 'utf-8')))),
  ]

  const amountOfSubTasks = workersLogs.length

  for (const workerLog of workersLogs) {
    const isExecutedAnySubTask = _.range(0, amountOfSubTasks).some(i =>
      workerLog.includes(`total=${workers.length + 1}, index=${i}`),
    )
    expect(isExecutedAnySubTask).toBeTruthy()
  }
})

test('1 worker but we specify totalWorkers=3 - we expect to run 3 sub tasks', async () => {
  const queueName = `queue-${chance().hash().slice(0, 8)}`
  const { runCi } = await createRepo({
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          scripts: {
            test: `echo "total=$TOTAL_KEY_NAME, index=$INDEX_KEY_NAME"`,
          },
          tests: {
            'test1.spec.js': '',
            'test2.spec.js': '',
            'test3.spec.js': '',
          },
        },
      ],
    },
    configurations: {
      taskQueues: [
        taskWorkerTaskQueue({
          queueName,
          redis: {
            url: getResources().redisServerUrl,
          },
        }),
      ],
      steps: createLinearStepsGraph([
        testStep({
          isStepEnabled: true,
          scriptName: 'test',
          splitTestsToMultipleVms: {
            totalWorkers: 3,
            relativeGlobToSearchTestFiles: 'tests/*.spec.js',
            startIndexingFromZero: true,
            env: {
              indexKeyEnvName: 'INDEX_KEY_NAME',
              totalVmsEnvKeyName: 'TOTAL_KEY_NAME',
            },
          },
        }),
      ]),
    },
  })

  const { flowLogs } = await runCi()

  const amountOfSubTasks = 3

  for (let i = 0; i < 3; i++) {
    const isExecutedAnySubTask = _.range(0, amountOfSubTasks).some(i => flowLogs.includes(`total=3, index=${i}`))
    expect(isExecutedAnySubTask).toBeTruthy()
  }
})
