import { createRepo, createTest, isDeepSubset, test } from '@era-ci/e2e-tests-infra'
import { test as testStep } from '@era-ci/steps'
import { createLinearStepsGraph } from '@era-ci/steps-graph'
import { taskWorkerTaskQueue } from '@era-ci/task-queues'
import { startWorker } from '@era-ci/task-worker'
import { ExecutionStatus, Status } from '@era-ci/utils'
import chance from 'chance'
import expect from 'expect'
import fs from 'fs'

createTest(test)

test('single worker - no packages', async t => {
  const queueName = `queue-${chance().hash().slice(0, 8)}`
  const { runCi } = await createRepo(t, {
    repo: {
      packages: [],
    },
    configurations: {
      taskQueues: [
        taskWorkerTaskQueue({
          queueName,
          redis: {
            url: t.context.resources.redisServerUrl,
          },
        }),
      ],
      steps: createLinearStepsGraph([
        testStep({
          scriptName: 'test',
        }),
      ]),
    },
  })

  const { passed } = await runCi()

  expect(passed).toBeTruthy()
})

test('single worker - no tasks', async t => {
  const queueName = `queue-${chance().hash().slice(0, 8)}`
  const { runCi } = await createRepo(t, {
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
            url: t.context.resources.redisServerUrl,
          },
        }),
      ],
      steps: createLinearStepsGraph([
        testStep({
          scriptName: 'test',
        }),
      ]),
    },
  })

  const { passed } = await runCi()

  expect(passed).toBeTruthy()
})

test('single worker - single task', async t => {
  const queueName = `queue-${chance().hash().slice(0, 8)}`
  const message = `hi-${chance().hash().slice(0, 8)}`
  const { runCi } = await createRepo(t, {
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
            url: t.context.resources.redisServerUrl,
          },
        }),
      ],
      steps: createLinearStepsGraph([
        testStep({
          scriptName: 'test',
        }),
      ]),
    },
  })

  const { flowLogs } = await runCi()

  expect(flowLogs).toEqual(expect.stringContaining(message))
  expect(flowLogs.split(message)).toHaveLength(3) // ensure the message was printed two times (printing the command and then the result of the command)
})

test('single worker - two tasks', async t => {
  const queueName = `queue-${chance().hash().slice(0, 8)}`
  const message1 = `hi-${chance().hash().slice(0, 8)}`
  const message2 = `hi-${chance().hash().slice(0, 8)}`
  const { runCi } = await createRepo(t, {
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
            url: t.context.resources.redisServerUrl,
          },
        }),
      ],
      steps: createLinearStepsGraph([
        testStep({
          scriptName: 'test',
        }),
      ]),
    },
  })

  const { flowLogs } = await runCi()

  expect(flowLogs).toEqual(expect.stringContaining(message1))
  expect(flowLogs.split(message1)).toHaveLength(3) // ensure the message was printed two times (printing the command and then the result of the command)

  expect(flowLogs).toEqual(expect.stringContaining(message2))
  expect(flowLogs.split(message2)).toHaveLength(3) // ensure the message was printed two times (printing the command and then the result of the command)
})

test('two workers - single task - only one worker should execute the task', async t => {
  const queueName = `queue-${chance().hash().slice(0, 8)}`
  const message = `hi-${chance().hash().slice(0, 8)}`
  const { runCi, repoPath } = await createRepo(t, {
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
            url: t.context.resources.redisServerUrl,
          },
        }),
      ],
      steps: createLinearStepsGraph([
        testStep({
          scriptName: 'test',
        }),
      ]),
    },
  })

  const worker2 = await startWorker({
    queueName,
    redis: {
      url: t.context.resources.redisServerUrl,
    },
    repoPath,
    maxWaitMsUntilFirstTask: 3_000,
    maxWaitMsWithoutTasks: 3_000,
  })

  const { flowLogs } = await runCi()
  const workerLogs = await fs.promises.readFile(worker2.logFilePath, 'utf-8')
  const combinedLogs = `${flowLogs}${workerLogs}`

  expect(combinedLogs).toEqual(expect.stringContaining(message))
  expect(combinedLogs.split(message)).toHaveLength(3) // ensure the message was printed two times (printing the command and then the result of the command)
  await worker2.cleanup() // we don't have to do it but it ends the test 1-2 seconds faster.
})

test('two workers - one task for each worker', async t => {
  const queueName = `queue-${chance().hash().slice(0, 8)}`
  const message1 = `hi-${chance().hash().slice(0, 8)}`
  const message2 = `hi-${chance().hash().slice(0, 8)}`
  const { runCi, repoPath } = await createRepo(t, {
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
            url: t.context.resources.redisServerUrl,
          },
        }),
      ],
      steps: createLinearStepsGraph([
        testStep({
          scriptName: 'test',
        }),
      ]),
    },
  })

  const worker2 = await startWorker({
    queueName,
    redis: {
      url: t.context.resources.redisServerUrl,
    },
    repoPath,
    maxWaitMsUntilFirstTask: 3_000,
    maxWaitMsWithoutTasks: 3_000,
  })

  const { flowLogs } = await runCi()

  const workerLogs = await fs.promises.readFile(worker2.logFilePath, 'utf-8')
  const combinedLogs = `${flowLogs}${workerLogs}`

  expect(combinedLogs).toEqual(expect.stringContaining(message1))
  expect(combinedLogs.split(message1)).toHaveLength(3) // ensure the message was printed two times (printing the command and then the result of the command)

  expect(combinedLogs).toEqual(expect.stringContaining(message2))
  expect(combinedLogs.split(message2)).toHaveLength(3) // ensure the message was printed two times (printing the command and then the result of the command)
  await worker2.cleanup() // we don't have to do it but it ends the test 1-2 seconds faster.
})

test('reproduce bug - single worker - single task - test should be skipped-as-passed in second run', async t => {
  const queueName = `queue-${chance().hash().slice(0, 8)}`
  const message = `hi-${chance().hash().slice(0, 8)}`
  const { runCi } = await createRepo(t, {
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
            url: t.context.resources.redisServerUrl,
          },
        }),
      ],
      steps: createLinearStepsGraph([
        testStep({
          scriptName: 'test',
        }),
      ]),
    },
  })

  await runCi()

  const { jsonReport } = await runCi()

  expect(
    isDeepSubset(t,jsonReport, {
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
