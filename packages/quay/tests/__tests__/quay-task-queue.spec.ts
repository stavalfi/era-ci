import { ExecutionStatus, Status } from '@tahini/nc'
import { QuayBuildsTaskQueue } from '@tahini/quay-task-queue'
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
  await taskQueue.addTasksToQueue([])
})

test('cleanup can be called multiple times', async () => {
  await taskQueue.cleanup()
  await taskQueue.cleanup()
})

test('cant add tasks after cleanup', async () => {
  await taskQueue.cleanup()
  expect(taskQueue.addTasksToQueue([])).rejects.toBeTruthy()
})

test('cleanup can be called multiple times concurrenctly', async () => {
  await Promise.all([taskQueue.cleanup(), taskQueue.cleanup()])
})

test('task is executed and we expect the docker-image to be presentin the registry', async () => {
  await taskQueue.addTasksToQueue([
    {
      packageName: getResoureces().packages.package1.name,
      imageTags: ['1.0.0'],
      relativeContextPath: '/',
      relativeDockerfilePath: getResoureces().packages.package1.relativeDockerFilePath,
    },
  ])

  await new Promise((res, rej) =>
    taskQueue.eventEmitter.addListener(ExecutionStatus.done, e => {
      if (e.taskResult.status === Status.passed) {
        res()
      } else {
        rej()
      }
    }),
  )

  expect(getImageTags('package1')).resolves.toEqual(['1.0.0'])
})

// test('events are fired', async () => {
//   const scheduled = jest.fn()
//   const running = jest.fn()

//   taskQueue.eventEmitter.addListener(ExecutionStatus.scheduled, scheduled)
//   taskQueue.eventEmitter.addListener(ExecutionStatus.running, running)

//   taskQueue.addTasksToQueue([{ taskName: 'task1', func: () => Promise.resolve() }])

//   await new Promise(res => taskQueue.eventEmitter.addListener(ExecutionStatus.done, res))

//   expect(scheduled).toHaveBeenCalledTimes(1)
//   expect(running).toHaveBeenCalledTimes(1)
// })

// test('events are fired even when task failed', async () => {
//   const scheduled = jest.fn()
//   const running = jest.fn()

//   taskQueue.eventEmitter.addListener(ExecutionStatus.scheduled, scheduled)
//   taskQueue.eventEmitter.addListener(ExecutionStatus.running, running)

//   taskQueue.addTasksToQueue([{ taskName: 'task1', func: () => Promise.reject('fail') }])

//   await new Promise(res => taskQueue.eventEmitter.addListener(ExecutionStatus.done, res))

//   expect(scheduled).toHaveBeenCalledTimes(1)
//   expect(running).toHaveBeenCalledTimes(1)
// })

// test('events schema is valid', async () => {
//   expect.assertions(3)

//   taskQueue.eventEmitter.addListener(ExecutionStatus.scheduled, event => {
//     expect(
//       isDeepSubsetOfOrPrint(event, {
//         taskExecutionStatus: ExecutionStatus.scheduled,
//         taskInfo: {
//           taskName: 'task1',
//         },
//         taskResult: {
//           executionStatus: ExecutionStatus.scheduled,
//         },
//       }),
//     ).toBeTruthy()
//   })

//   taskQueue.eventEmitter.addListener(ExecutionStatus.running, event => {
//     expect(
//       isDeepSubsetOfOrPrint(event, {
//         taskExecutionStatus: ExecutionStatus.running,
//         taskInfo: {
//           taskName: 'task1',
//         },
//         taskResult: {
//           executionStatus: ExecutionStatus.running,
//         },
//       }),
//     ).toBeTruthy()
//   })

//   taskQueue.addTasksToQueue([{ taskName: 'task1', func: () => Promise.resolve() }])

//   await new Promise(res =>
//     taskQueue.eventEmitter.addListener(ExecutionStatus.done, event => {
//       expect(
//         isDeepSubsetOfOrPrint(event, {
//           taskExecutionStatus: ExecutionStatus.done,
//           taskInfo: {
//             taskName: 'task1',
//           },
//           taskResult: {
//             executionStatus: ExecutionStatus.done,
//             status: Status.passed,
//             notes: [],
//             errors: [],
//           },
//         }),
//       ).toBeTruthy()
//       res()
//     }),
//   )
// })

// test('done events schema is valid when task fail', async () => {
//   taskQueue.addTasksToQueue([{ taskName: 'task1', func: () => Promise.reject('error1') }])

//   expect.hasAssertions()

//   await new Promise(res =>
//     taskQueue.eventEmitter.addListener(ExecutionStatus.done, event => {
//       expect(
//         isDeepSubsetOfOrPrint(event, {
//           taskExecutionStatus: ExecutionStatus.done,
//           taskInfo: {
//             taskName: 'task1',
//           },
//           taskResult: {
//             executionStatus: ExecutionStatus.done,
//             status: Status.failed,
//             notes: [],
//             errors: ['error1'],
//           },
//         }),
//       ).toBeTruthy()
//       res()
//     }),
//   )
// })

// test('abort event is fired for all tasks when queue is cleaned before the tasks are executed', async () => {
//   const scheduled = jest.fn()
//   const running = jest.fn()
//   const aborted = jest.fn()

//   taskQueue.eventEmitter.addListener(ExecutionStatus.scheduled, scheduled)
//   taskQueue.eventEmitter.addListener(ExecutionStatus.running, running)
//   taskQueue.eventEmitter.addListener(ExecutionStatus.aborted, aborted)

//   const shouldntBeCalled = jest.fn()

//   taskQueue.addTasksToQueue([
//     {
//       taskName: 'task1',
//       func: () => sleep(300_000, cleanups),
//     },
//     {
//       taskName: 'task2',
//       func: shouldntBeCalled,
//     },
//   ])

//   await taskQueue.cleanup()

//   expect(scheduled).toHaveBeenCalledTimes(2)
//   expect(running).toHaveBeenCalledTimes(0)
//   expect(aborted).toHaveBeenCalledTimes(2)
//   expect(shouldntBeCalled).not.toHaveBeenCalled()
// })

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
