import { QuayBuildsTaskQueue } from '@tahini/quay-task-queue'
import { beforeAfterEach } from '../utils'

const { getResoureces } = beforeAfterEach()

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
  expect(taskQueue.addTasksToQueue([])).rejects.toBeTruthy()
})

test('cleanup can be called multiple times concurrenctly', async () => {
  await Promise.all([taskQueue.cleanup(), taskQueue.cleanup()])
})
