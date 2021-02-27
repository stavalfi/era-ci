import { createTest, isDeepSubset } from '@era-ci/e2e-tests-infra'
import { test as testStep } from '@era-ci/steps'
import { createLinearStepsGraph } from '@era-ci/steps-graph'
import { taskWorkerTaskQueue } from '@era-ci/task-queues'
import { startWorker } from '@era-ci/task-worker'
import { ExecutionStatus, Status } from '@era-ci/utils'
import { expect, test } from '@jest/globals'
import chance from 'chance'
import fs from 'fs'
import _ from 'lodash'

const { getCleanups, createRepo, getProcessEnv, getResources, createTestLogger, createRedisConnection } = createTest()

test('single worker - no packages', async () => {
  const queueName = `queue-${chance().hash().slice(0, 8)}`
  const { runCi } = await createRepo({
    repo: {
      packages: [],
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
        }),
      ]),
    },
  })

  const { passed } = await runCi()

  expect(passed).toBeTruthy()
})

test('single worker - no tasks', async () => {
  const queueName = `queue-${chance().hash().slice(0, 8)}`
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
        }),
      ]),
    },
  })

  const { passed } = await runCi()

  expect(passed).toBeTruthy()
})

test('single worker - single task', async () => {
  const queueName = `queue-${chance().hash().slice(0, 8)}`
  const message = `hi-${chance().hash().slice(0, 8)}`
  const { runCi } = await createRepo({
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          scripts: {
            test: `echo ${message}`,
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
        }),
      ]),
    },
  })

  const { flowLogs } = await runCi()

  expect(flowLogs).toEqual(expect.stringContaining(message))
  expect(flowLogs.split(message)).toHaveLength(3)
})

test('splitTestsToMultipleVms=false - single worker - single task - ensure the ci do not set TOTAL_KEY_NAME', async () => {
  const queueName = `queue-${chance().hash().slice(0, 8)}`
  const { runCi } = await createRepo({
    // packageManager: PackageManager.yarn2,
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          scripts: {
            test: `echo "total=$TOTAL_KEY_NAME"`,
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
          splitTestsToMultipleVms: false,
        }),
      ]),
    },
  })

  const { flowLogs } = await runCi()
  expect(flowLogs).toEqual(expect.stringContaining('total=\n'))
})

test('splitTestsToMultipleVms=false - single worker - single task - ensure the ci do not set INDEX_KEY_NAME', async () => {
  const queueName = `queue-${chance().hash().slice(0, 8)}`
  const { runCi } = await createRepo({
    // packageManager: PackageManager.yarn2,
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          scripts: {
            test: `echo "index=$INDEX_KEY_NAME"`,
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
          splitTestsToMultipleVms: false,
        }),
      ]),
    },
  })

  const { flowLogs } = await runCi()
  expect(flowLogs).toEqual(expect.stringContaining('index=\n'))
})

test('splitTestsToMultipleVms=undefined - single worker - single task', async () => {
  const queueName = `queue-${chance().hash().slice(0, 8)}`
  const { runCi } = await createRepo({
    // packageManager: PackageManager.yarn2,
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          scripts: {
            test: `echo "total=$TOTAL_KEY_NAME"`,
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
          splitTestsToMultipleVms: undefined,
        }),
      ]),
    },
  })

  const { flowLogs } = await runCi()
  expect(flowLogs).toEqual(expect.stringContaining('total=\n'))
})

test('single worker - two tasks', async () => {
  const queueName = `queue-${chance().hash().slice(0, 8)}`
  const message1 = `hi-${chance().hash().slice(0, 8)}`
  const message2 = `hi-${chance().hash().slice(0, 8)}`
  const { runCi } = await createRepo({
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          scripts: {
            test: `echo ${message1}`,
          },
        },
        {
          name: 'b',
          version: '1.0.0',
          scripts: {
            test: `echo ${message2}`,
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
        }),
      ]),
    },
  })

  const { flowLogs } = await runCi()

  expect(flowLogs).toEqual(expect.stringContaining(message1))
  expect(flowLogs.split(message1)).toHaveLength(3)

  expect(flowLogs).toEqual(expect.stringContaining(message2))
  expect(flowLogs.split(message2)).toHaveLength(3)
})

test('two workers - single task - only one worker should execute the task', async () => {
  const queueName = `queue-${chance().hash().slice(0, 8)}`
  const message = `hi-${chance().hash().slice(0, 8)}`
  const { runCi, repoPath } = await createRepo({
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          scripts: {
            test: `echo ${message}`,
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
      steps: createLinearStepsGraph([testStep({ isStepEnabled: true, scriptName: 'test' })]),
    },
  })

  const worker2 = await startWorker({
    config: {
      queueName,
      redis: {
        url: getResources().redisServerUrl,
      },
      maxWaitMsUntilFirstTask: 3_000,
      maxWaitMsWithoutTasks: 3_000,
    },
    redisConnection: createRedisConnection(),
    processEnv: getProcessEnv(),
    logger: await createTestLogger(repoPath),
  })

  const { flowLogs } = await runCi()
  const workerLogs = await fs.promises.readFile(worker2.logFilePath, 'utf-8')
  const combinedLogs = `${flowLogs}${workerLogs}`

  expect(combinedLogs).toEqual(expect.stringContaining(message))
  expect(combinedLogs.split(message)).toHaveLength(3)
  await worker2.cleanup() // we don't have to do it but it ends the test 1-2 seconds faster.
})

test('two workers - one task for each worker', async () => {
  const queueName = `queue-${chance().hash().slice(0, 8)}`
  const message1 = `hi-${chance().hash().slice(0, 8)}`
  const message2 = `hi-${chance().hash().slice(0, 8)}`
  const { runCi, repoPath } = await createRepo({
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          scripts: {
            test: `echo ${message1}`,
          },
        },
        {
          name: 'b',
          version: '1.0.0',
          scripts: {
            test: `echo ${message2}`,
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
      steps: createLinearStepsGraph([testStep({ isStepEnabled: true, scriptName: 'test' })]),
    },
  })

  const worker2 = await startWorker({
    config: {
      queueName,
      redis: {
        url: getResources().redisServerUrl,
      },
      maxWaitMsUntilFirstTask: 3_000,
      maxWaitMsWithoutTasks: 3_000,
    },
    redisConnection: createRedisConnection(),
    processEnv: getProcessEnv(),
    logger: await createTestLogger(repoPath),
  })

  const { flowLogs } = await runCi()

  const workerLogs = await fs.promises.readFile(worker2.logFilePath, 'utf-8')
  const combinedLogs = `${flowLogs}${workerLogs}`

  expect(combinedLogs).toEqual(expect.stringContaining(message1))
  expect(combinedLogs.split(message1)).toHaveLength(3)

  expect(combinedLogs).toEqual(expect.stringContaining(message2))
  expect(combinedLogs.split(message2)).toHaveLength(3)
  await worker2.cleanup() // we don't have to do it but it ends the test 1-2 seconds faster.
})

test('reproduce bug - single worker - single task - test should be skipped-as-passed in second run', async () => {
  const queueName = `queue-${chance().hash().slice(0, 8)}`
  const message = `hi-${chance().hash().slice(0, 8)}`
  const { runCi } = await createRepo({
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          scripts: {
            test: `echo ${message}`,
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
      steps: createLinearStepsGraph([testStep({ isStepEnabled: true, scriptName: 'test' })]),
    },
  })

  await runCi()

  const { jsonReport } = await runCi()

  expect(
    isDeepSubset(jsonReport, {
      stepsResultOfArtifactsByStep: [
        {
          data: {
            stepInfo: {
              stepName: 'test',
            },
            stepExecutionStatus: ExecutionStatus.aborted,
            stepResult: {
              executionStatus: ExecutionStatus.aborted,
              status: Status.skippedAsPassed,
              errors: [],
              notes: [],
            },
            artifactsResult: [
              {
                data: {
                  artifactStepResult: {
                    executionStatus: ExecutionStatus.aborted,
                    status: Status.skippedAsPassed,
                    errors: [],
                    notes: [],
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

test('6 workers - all of them should be stopped when the flow is finished - no tasks', async () => {
  const queueName = `queue-${chance().hash().slice(0, 8)}`
  const { runCi, repoPath } = await createRepo({
    repo: {
      packages: [],
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
    },
  })

  const logger = await createTestLogger(repoPath)

  await Promise.all([
    runCi().then<void>(() => {
      //
    }),
    ..._.range(0, 5).map(
      () =>
        new Promise<void>(res =>
          startWorker({
            config: {
              queueName,
              redis: {
                url: getResources().redisServerUrl,
              },
              maxWaitMsUntilFirstTask: 3_000,
              maxWaitMsWithoutTasks: 3_000,
            },
            redisConnection: createRedisConnection(),
            processEnv: getProcessEnv(),
            logger,
            onFinish: async () => res(),
          }),
        ),
    ),
  ])
})

test('6 workers - all of them should be stopped when the flow is finished - single task - some of the workers will run a task and some of them will not', async () => {
  const queueName = `queue-${chance().hash().slice(0, 8)}`
  const message1 = `hi-${chance().hash().slice(0, 8)}`
  const message2 = `hi-${chance().hash().slice(0, 8)}`
  const { runCi, repoPath } = await createRepo({
    repo: {
      packages: [
        {
          name: 'a',
          version: '1.0.0',
          scripts: {
            test: `echo ${message1}`,
          },
        },
        {
          name: 'b',
          version: '1.0.0',
          scripts: {
            test: `echo ${message2}`,
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
      steps: createLinearStepsGraph([testStep({ isStepEnabled: true, scriptName: 'test' })]),
    },
  })

  const logger = await createTestLogger(repoPath)

  const workers = await Promise.all(
    _.range(0, 5).map(i =>
      startWorker({
        config: {
          queueName,
          redis: {
            url: getResources().redisServerUrl,
          },
          maxWaitMsUntilFirstTask: 3_000,
          maxWaitMsWithoutTasks: 3_000,
        },
        redisConnection: createRedisConnection(),
        processEnv: getProcessEnv(),
        logger,
      }),
    ),
  )
  getCleanups().cleanups.push(() => Promise.all(workers.map(w => w.cleanup())))

  const { flowLogs } = await runCi()

  const workersLogs = await Promise.all(workers.map(worker => fs.promises.readFile(worker.logFilePath, 'utf-8')))
  const combinedLogs = `${flowLogs}${workersLogs.join('')}`

  expect(combinedLogs).toEqual(expect.stringContaining(message1))
  expect(combinedLogs).toEqual(expect.stringContaining(message2))

  // the test won't complete if the workers won't finish because they open connections to redis
})
