import { LogLevel } from '@era-ci/core'
import { isDeepSubset, sleep } from '@era-ci/e2e-tests-infra'
import { winstonLogger } from '@era-ci/loggers'
import { LocalSequentalTaskQueue, localSequentalTaskQueue } from '@era-ci/task-queues'
import { ExecutionStatus, Status } from '@era-ci/utils'
import anyTest, { TestInterface } from 'ava'
import { createFolder } from 'create-folder-structure'
import expect from 'expect'
import sinon from 'sinon'

export type TestWithContextType = {
  taskQueue: LocalSequentalTaskQueue
  cleanups: (() => Promise<unknown>)[]
  sleep: (ms: number) => Promise<void>
}

const test = anyTest as TestInterface<TestWithContextType>

test.serial.beforeEach(async t => {
  t.context.cleanups = []
  t.context.sleep = sleep(t.context.cleanups)
  const repoPath = await createFolder()
  const logger = await winstonLogger({
    customLogLevel: LogLevel.trace,
    logFilePath: 'era-ci.log',
    disabled: false,
  }).callInitializeLogger({ repoPath, customLog: t.log.bind(t) })

  t.context.taskQueue = await localSequentalTaskQueue().createFunc({
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
})

test.serial.afterEach(async t => {
  await t.context.taskQueue.cleanup()
  await Promise.allSettled(t.context.cleanups.map(f => f()))
})

test('cleanup dont throw when queue is empty', async t => {
  // ensure even if we don't use the queue, it won't throw errors.
})

test('can add zero length array', async t => {
  t.context.taskQueue.addTasksToQueue([])
})

test('cleanup can be called multiple times', async t => {
  await t.context.taskQueue.cleanup()
  await t.context.taskQueue.cleanup()
})

test('cant add tasks after cleanup', async t => {
  await t.context.taskQueue.cleanup()
  expect(() => t.context.taskQueue.addTasksToQueue([])).toThrow()
})

test('cleanup can be called multiple times concurrenctly', async t => {
  await Promise.all([t.context.taskQueue.cleanup(), t.context.taskQueue.cleanup()])
})

test('task is executed', async t => {
  const func = sinon.fake.resolves(void 0)
  t.context.taskQueue.addTasksToQueue([{ taskName: 'task1', func }])

  await new Promise(res => t.context.taskQueue.eventEmitter.addListener(ExecutionStatus.done, res))

  expect(func.calledOnce).toBeTruthy()
})

test('events are fired', async t => {
  const scheduled = sinon.fake()
  const running = sinon.fake()

  t.context.taskQueue.eventEmitter.addListener(ExecutionStatus.scheduled, scheduled)
  t.context.taskQueue.eventEmitter.addListener(ExecutionStatus.running, running)

  t.context.taskQueue.addTasksToQueue([{ taskName: 'task1', func: () => Promise.resolve() }])

  await new Promise(res => t.context.taskQueue.eventEmitter.addListener(ExecutionStatus.done, res))

  expect(scheduled.calledOnce).toBeTruthy()
  expect(running.calledOnce).toBeTruthy()
})

test('events are fired even when task failed', async t => {
  const scheduled = sinon.fake()
  const running = sinon.fake()

  t.context.taskQueue.eventEmitter.addListener(ExecutionStatus.scheduled, scheduled)
  t.context.taskQueue.eventEmitter.addListener(ExecutionStatus.running, running)

  t.context.taskQueue.addTasksToQueue([{ taskName: 'task1', func: () => Promise.reject('fail') }])

  await new Promise(res => t.context.taskQueue.eventEmitter.addListener(ExecutionStatus.done, res))

  expect(scheduled.calledOnce).toBeTruthy()
  expect(running.calledOnce).toBeTruthy()
})

test('events schema is valid', async t => {
  expect.assertions(3)

  t.context.taskQueue.eventEmitter.addListener(ExecutionStatus.scheduled, event => {
    expect(
      isDeepSubset(t, event, {
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

  t.context.taskQueue.eventEmitter.addListener(ExecutionStatus.running, event => {
    expect(
      isDeepSubset(t, event, {
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

  t.context.taskQueue.addTasksToQueue([{ taskName: 'task1', func: () => Promise.resolve() }])

  await new Promise<void>(res =>
    t.context.taskQueue.eventEmitter.addListener(ExecutionStatus.done, event => {
      expect(
        isDeepSubset(t, event, {
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

test('done events schema is valid when task fail', async t => {
  t.context.taskQueue.addTasksToQueue([{ taskName: 'task1', func: () => Promise.reject(new Error('error1')) }])

  expect.hasAssertions()

  await new Promise<void>(res =>
    t.context.taskQueue.eventEmitter.addListener(ExecutionStatus.done, event => {
      expect(
        isDeepSubset(t, event, {
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

test('abort event is fired for all tasks when queue is cleaned (before the tasks are executed)', async t => {
  const scheduled = sinon.fake()
  const running = sinon.fake()
  const aborted = sinon.fake()

  t.context.taskQueue.eventEmitter.addListener(ExecutionStatus.scheduled, scheduled)
  t.context.taskQueue.eventEmitter.addListener(ExecutionStatus.running, running)
  t.context.taskQueue.eventEmitter.addListener(ExecutionStatus.aborted, aborted)

  const shouldntBeCalled = sinon.fake()

  t.context.taskQueue.addTasksToQueue([
    {
      taskName: 'task1',
      func: () => t.context.sleep(300_000),
    },
    {
      taskName: 'task2',
      func: shouldntBeCalled,
    },
  ])

  await t.context.taskQueue.cleanup()

  expect(scheduled.calledTwice).toBeTruthy()
  expect(running.notCalled).toBeTruthy()
  expect(aborted.calledTwice).toBeTruthy()
  expect(shouldntBeCalled.notCalled).toBeTruthy()
})

test('abort event is fired for running tasks', async t => {
  const aborted = sinon.fake()

  t.context.taskQueue.eventEmitter.addListener(ExecutionStatus.aborted, aborted)

  t.context.taskQueue.addTasksToQueue([
    {
      taskName: 'task1',
      func: () => t.context.sleep(300_000),
    },
  ])

  await new Promise(res => t.context.taskQueue.eventEmitter.addListener(ExecutionStatus.running, res))

  await t.context.taskQueue.cleanup()

  expect(aborted.calledOnce).toBeTruthy()
})

test('abort events schema is valid', async t => {
  t.context.taskQueue.addTasksToQueue([{ taskName: 'task1', func: () => t.context.sleep(300_000) }])

  expect.hasAssertions()

  t.context.taskQueue.eventEmitter.addListener(ExecutionStatus.aborted, event => {
    expect(
      isDeepSubset(t, event, {
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

  await t.context.taskQueue.cleanup()
})
