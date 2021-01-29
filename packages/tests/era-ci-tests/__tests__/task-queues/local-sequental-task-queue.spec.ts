import { connectToRedis } from '@era-ci/core'
import { createTest, isDeepSubset } from '@era-ci/e2e-tests-infra'
import { LocalSequentalTaskQueue, localSequentalTaskQueue } from '@era-ci/task-queues'
import { ExecutionStatus, Status } from '@era-ci/utils'
import { createFolder } from 'create-folder-structure'
import expect from 'expect'
import sinon from 'sinon'

const { getCleanups, sleep, createTestLogger, getResources } = createTest()

let taskQueue: LocalSequentalTaskQueue

beforeEach(async () => {
  const repoPath = await createFolder()
  const logger = await createTestLogger(repoPath)
  const redisClient = await connectToRedis({
    config: {
      url: getResources().redisServerUrl,
    },
    logger,
  })
  getCleanups().connectionCleanups.push(redisClient.cleanup)
  taskQueue = await localSequentalTaskQueue().createFunc({
    redisClient,
    log: logger.createLog('task-queue'),
    gitRepoInfo: {
      auth: {
        token: '-',
        username: '-',
      },
      commit: '-',
      repoName: '-',
      repoNameWithOrgName: '-/-',
    },
    logger,
    repoPath,
    processEnv: {},
  })
  getCleanups().cleanups.push(taskQueue.cleanup)
})

test('cleanup dont throw when queue is empty', async () => {
  // NOTE: this is the test. it's not a mistake!
  // ensure even if we don't use the queue, it won't throw errors.
})

test('can add zero length array', async () => {
  taskQueue.addTasksToQueue([])
})

test('cleanup can be called multiple times', async () => {
  await taskQueue.cleanup()
  await taskQueue.cleanup()
})

test('cant add tasks after cleanup', async () => {
  await taskQueue.cleanup()
  expect(() => taskQueue.addTasksToQueue([])).toThrow()
})

test('cleanup can be called multiple times concurrenctly', async () => {
  await Promise.all([taskQueue.cleanup(), taskQueue.cleanup()])
})

test('task is executed', async () => {
  const func = sinon.fake.resolves(void 0)
  taskQueue.addTasksToQueue([{ taskName: 'task1', func }])

  await new Promise(res => taskQueue.eventEmitter.addListener(ExecutionStatus.done, res))

  expect(func.calledOnce).toBeTruthy()
})

test('events are fired', async () => {
  const scheduled = sinon.fake()
  const running = sinon.fake()

  taskQueue.eventEmitter.addListener(ExecutionStatus.scheduled, scheduled)
  taskQueue.eventEmitter.addListener(ExecutionStatus.running, running)

  taskQueue.addTasksToQueue([{ taskName: 'task1', func: () => Promise.resolve() }])

  await new Promise(res => taskQueue.eventEmitter.addListener(ExecutionStatus.done, res))

  expect(scheduled.calledOnce).toBeTruthy()
  expect(running.calledOnce).toBeTruthy()
})

test('events are fired even when task failed', async () => {
  const scheduled = sinon.fake()
  const running = sinon.fake()

  taskQueue.eventEmitter.addListener(ExecutionStatus.scheduled, scheduled)
  taskQueue.eventEmitter.addListener(ExecutionStatus.running, running)

  taskQueue.addTasksToQueue([{ taskName: 'task1', func: () => Promise.reject('fail') }])

  await new Promise(res => taskQueue.eventEmitter.addListener(ExecutionStatus.done, res))

  expect(scheduled.calledOnce).toBeTruthy()
  expect(running.calledOnce).toBeTruthy()
})

test('events schema is valid', async () => {
  expect.assertions(3)

  taskQueue.eventEmitter.addListener(ExecutionStatus.scheduled, event => {
    expect(
      isDeepSubset(event, {
        taskExecutionStatus: ExecutionStatus.scheduled,
        taskInfo: {
          taskName: 'task1',
        },
        taskResult: {
          executionStatus: ExecutionStatus.scheduled,
        },
      }),
    ).toBeTruthy()
  })

  taskQueue.eventEmitter.addListener(ExecutionStatus.running, event => {
    expect(
      isDeepSubset(event, {
        taskExecutionStatus: ExecutionStatus.running,
        taskInfo: {
          taskName: 'task1',
        },
        taskResult: {
          executionStatus: ExecutionStatus.running,
        },
      }),
    ).toBeTruthy()
  })

  taskQueue.addTasksToQueue([{ taskName: 'task1', func: () => Promise.resolve() }])

  await new Promise<void>(res =>
    taskQueue.eventEmitter.addListener(ExecutionStatus.done, event => {
      expect(
        isDeepSubset(event, {
          taskExecutionStatus: ExecutionStatus.done,
          taskInfo: {
            taskName: 'task1',
          },
          taskResult: {
            executionStatus: ExecutionStatus.done,
            status: Status.passed,
            notes: [],
            errors: [],
          },
        }),
      ).toBeTruthy()
      res()
    }),
  )
})

test('done events schema is valid when task fail', async () => {
  taskQueue.addTasksToQueue([{ taskName: 'task1', func: () => Promise.reject(new Error('error1')) }])

  expect.hasAssertions()

  await new Promise<void>(res =>
    taskQueue.eventEmitter.addListener(ExecutionStatus.done, event => {
      expect(
        isDeepSubset(event, {
          taskExecutionStatus: ExecutionStatus.done,
          taskInfo: {
            taskName: 'task1',
          },
          taskResult: {
            executionStatus: ExecutionStatus.done,
            status: Status.failed,
            notes: [],
            errors: [
              {
                message: 'error1',
              },
            ],
          },
        }),
      ).toBeTruthy()
      res()
    }),
  )
})

test('abort event is fired for all tasks when queue is cleaned (before the tasks are executed)', async () => {
  const scheduled = sinon.fake()
  const running = sinon.fake()
  const aborted = sinon.fake()

  taskQueue.eventEmitter.addListener(ExecutionStatus.scheduled, scheduled)
  taskQueue.eventEmitter.addListener(ExecutionStatus.running, running)
  taskQueue.eventEmitter.addListener(ExecutionStatus.aborted, aborted)

  const shouldntBeCalled = sinon.fake()

  taskQueue.addTasksToQueue([
    {
      taskName: 'task1',
      func: () => sleep(10_000),
    },
    {
      taskName: 'task2',
      func: shouldntBeCalled,
    },
  ])

  await taskQueue.cleanup()

  expect(scheduled.calledTwice).toBeTruthy()
  expect(running.notCalled).toBeTruthy()
  expect(aborted.calledTwice).toBeTruthy()
  expect(shouldntBeCalled.notCalled).toBeTruthy()
})

test('abort event is fired for running tasks', async () => {
  const aborted = sinon.fake()

  taskQueue.eventEmitter.addListener(ExecutionStatus.aborted, aborted)

  taskQueue.addTasksToQueue([
    {
      taskName: 'task1',
      func: () => sleep(10_000),
    },
  ])

  await new Promise(res => taskQueue.eventEmitter.addListener(ExecutionStatus.running, res))

  await taskQueue.cleanup()

  expect(aborted.calledOnce).toBeTruthy()
})

test('abort events schema is valid', async () => {
  taskQueue.addTasksToQueue([{ taskName: 'task1', func: () => sleep(10_000) }])

  expect.hasAssertions()

  taskQueue.eventEmitter.addListener(ExecutionStatus.aborted, event => {
    expect(
      isDeepSubset(event, {
        taskExecutionStatus: ExecutionStatus.aborted,
        taskInfo: {
          taskName: 'task1',
        },
        taskResult: {
          executionStatus: ExecutionStatus.aborted,
          status: Status.skippedAsFailed,
          notes: [],
          errors: [],
        },
      }),
    ).toBeTruthy()
  })

  await taskQueue.cleanup()
})
