import { isDeepSubsetOfOrPrint } from '@tahini/e2e-tests-infra'
import { DoneTask, ExecutionStatus, RunningTask, ScheduledTask, Status, toTaskQueueEvent$ } from '@tahini/nc'
import { QuayBuildsTaskQueue } from '@tahini/quay-task-queue'
import { first, toArray, map } from 'rxjs/operators'
import { beforeAfterEach } from './utils'

const { getResoureces, getImageTags } = beforeAfterEach()

let taskQueue: QuayBuildsTaskQueue

beforeEach(() => {
  taskQueue = getResoureces().queue
})

test('cleanup dont throw when queue is empty', async () => {
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

test('task is executed and we expect the docker-image to be presentin the registry', async () => {
  taskQueue.addTasksToQueue([
    {
      packageName: getResoureces().packages.package1.name,
      imageTags: ['1.0.0'],
      relativeContextPath: '/',
      relativeDockerfilePath: getResoureces().packages.package1.relativeDockerFilePath,
    },
  ])

  await toTaskQueueEvent$(taskQueue.eventEmitter, { errorOnTaskNotPassed: true }).toPromise()

  expect(getImageTags(getResoureces().packages.package1.name)).resolves.toEqual(['1.0.0'])
})

test('scheduled and running events are fired', async () => {
  const scheduled = jest.fn()
  const running = jest.fn()

  taskQueue.eventEmitter.addListener(ExecutionStatus.scheduled, scheduled)
  taskQueue.eventEmitter.addListener(ExecutionStatus.running, running)

  taskQueue.addTasksToQueue([
    {
      packageName: getResoureces().packages.package1.name,
      imageTags: ['1.0.0'],
      relativeContextPath: '/',
      relativeDockerfilePath: getResoureces().packages.package1.relativeDockerFilePath,
    },
  ])

  await toTaskQueueEvent$(taskQueue.eventEmitter, { errorOnTaskNotPassed: true }).toPromise()

  expect(scheduled).toHaveBeenCalledTimes(1)
  expect(running).toHaveBeenCalledTimes(1)
})

test('events are fired even when task failed', async () => {
  const scheduled = jest.fn()
  const running = jest.fn()

  taskQueue.eventEmitter.addListener(ExecutionStatus.scheduled, scheduled)
  taskQueue.eventEmitter.addListener(ExecutionStatus.running, running)

  taskQueue.addTasksToQueue([
    {
      packageName: getResoureces().packages.package1.name,
      imageTags: ['1.0.0'],
      relativeContextPath: '/invalid-path-to-context',
      relativeDockerfilePath: getResoureces().packages.package1.relativeDockerFilePath,
    },
  ])

  const doneEvent = await toTaskQueueEvent$(taskQueue.eventEmitter)
    .pipe(
      first(e => e.taskExecutionStatus === ExecutionStatus.done),
      map(e => e as DoneTask),
    )
    .toPromise()

  expect(scheduled).toHaveBeenCalledTimes(1)
  expect(running).toHaveBeenCalledTimes(1)
  expect(doneEvent.taskResult.status).toEqual(Status.failed)
})

test('events schema is valid', async () => {
  taskQueue.addTasksToQueue([
    {
      packageName: getResoureces().packages.package1.name,
      imageTags: ['1.0.0'],
      relativeContextPath: '/',
      relativeDockerfilePath: getResoureces().packages.package1.relativeDockerFilePath,
    },
  ])

  const [scheduled, running, done] = await toTaskQueueEvent$(taskQueue.eventEmitter)
    .pipe(
      toArray(),
      map(array => [array[0] as ScheduledTask, array[1] as RunningTask, array[2] as DoneTask]),
    )
    .toPromise()

  expect(
    isDeepSubsetOfOrPrint(scheduled, {
      taskExecutionStatus: ExecutionStatus.scheduled,
      taskResult: {
        executionStatus: ExecutionStatus.scheduled,
      },
    }),
  ).toBeTruthy()

  expect(
    isDeepSubsetOfOrPrint(running, {
      taskExecutionStatus: ExecutionStatus.running,
      taskResult: {
        executionStatus: ExecutionStatus.running,
      },
    }),
  ).toBeTruthy()

  expect(
    isDeepSubsetOfOrPrint(done, {
      taskExecutionStatus: ExecutionStatus.done,
      taskResult: {
        executionStatus: ExecutionStatus.done,
        status: Status.passed,
        notes: [],
        errors: [],
      },
    }),
  ).toBeTruthy()
})

test('done events schema is valid when task fail', async () => {
  taskQueue.addTasksToQueue([
    {
      packageName: getResoureces().packages.package1.name,
      imageTags: ['1.0.0'],
      relativeContextPath: '/invalid-path-to-context',
      relativeDockerfilePath: getResoureces().packages.package1.relativeDockerFilePath,
    },
  ])

  const done = await toTaskQueueEvent$(taskQueue.eventEmitter)
    .pipe(
      first(e => e.taskExecutionStatus === ExecutionStatus.done),
      map(e => e as DoneTask),
    )
    .toPromise()

  expect(
    isDeepSubsetOfOrPrint(done, {
      taskExecutionStatus: ExecutionStatus.done,
      taskResult: {
        executionStatus: ExecutionStatus.done,
        status: Status.failed,
        errors: [],
      },
    }),
  ).toBeTruthy()
  expect(done.taskResult.notes[0]).toMatch('build-logs:')
})

test('abort event is fired for all tasks when queue is cleaned before the tasks are executed', async () => {
  const scheduled = jest.fn()
  const running = jest.fn()
  const aborted = jest.fn()

  taskQueue.eventEmitter.addListener(ExecutionStatus.scheduled, scheduled)
  taskQueue.eventEmitter.addListener(ExecutionStatus.running, running)
  taskQueue.eventEmitter.addListener(ExecutionStatus.aborted, aborted)

  taskQueue.addTasksToQueue([
    {
      packageName: getResoureces().packages.package1.name,
      imageTags: ['1.0.0'],
      relativeContextPath: '/',
      relativeDockerfilePath: getResoureces().packages.package1.relativeDockerFilePath,
    },
    {
      packageName: getResoureces().packages.package2.name,
      imageTags: ['1.0.0'],
      relativeContextPath: '/',
      relativeDockerfilePath: getResoureces().packages.package2.relativeDockerFilePath,
    },
  ])

  await taskQueue.cleanup()

  expect(scheduled).toHaveBeenCalledTimes(2)
  expect(running).toHaveBeenCalledTimes(0)
  expect(aborted).toHaveBeenCalledTimes(2)

  expect(getImageTags(getResoureces().packages.package1.name)).resolves.toEqual([])
  expect(getImageTags(getResoureces().packages.package2.name)).resolves.toEqual([])
})

// test('abort event is fired for running tasks', async () => {
//   const aborted = jest.fn()

//   taskQueue.eventEmitter.addListener(ExecutionStatus.aborted, aborted)

//   taskQueue.addTasksToQueue([
//     {
//       taskName: 'task1',
//       func: () => sleep(300_000, cleanups),
//     },
//   ])

//   await new Promise(res => taskQueue.eventEmitter.addListener(ExecutionStatus.running, res))

//   await taskQueue.cleanup()

//   expect(aborted).toHaveBeenCalledTimes(1)
// })

// test('abort events schema is valid', async () => {
//   taskQueue.addTasksToQueue([{ taskName: 'task1', func: () => sleep(300_000, cleanups) }])

//   expect.hasAssertions()

//   taskQueue.eventEmitter.addListener(ExecutionStatus.aborted, event => {
//     expect(
//       isDeepSubsetOfOrPrint(event, {
//         taskExecutionStatus: ExecutionStatus.aborted,
//         taskInfo: {
//           taskName: 'task1',
//         },
//         taskResult: {
//           executionStatus: ExecutionStatus.aborted,
//           status: Status.skippedAsFailed,
//           notes: [],
//           errors: [],
//         },
//       }),
//     ).toBeTruthy()
//   })

//   await taskQueue.cleanup()
// })
