import { isDeepSubset } from '@era-ci/e2e-tests-infra'
import { AbortedTask, DoneTask, RunningTask, ScheduledTask, toTaskEvent$ } from '@era-ci/core'
import { distructPackageJsonName, ExecutionStatus, Status } from '@era-ci/utils'
import { QuayBuildsTaskPayload, QuayBuildsTaskQueue } from '@era-ci/task-queues'
import fs from 'fs'
import path from 'path'
import { first, map, toArray } from 'rxjs/operators'
import { beforeAfterEach } from '../utils'
import { merge } from 'rxjs'

const { getResources, getImageTags } = beforeAfterEach()

let taskQueue: QuayBuildsTaskQueue

beforeEach(() => {
  taskQueue = getResources().queue
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
  const [{ taskId }] = taskQueue.addTasksToQueue([
    {
      packageName: getResources().packages.package1.name,
      repoName: distructPackageJsonName(getResources().packages.package1.name).name,
      visibility: 'public',
      imageTags: ['1.0.0'],
      relativeContextPath: '/',
      relativeDockerfilePath: getResources().packages.package1.relativeDockerFilePath,
      taskTimeoutMs: 10000,
    },
  ])

  await toTaskEvent$(taskId, { eventEmitter: taskQueue.eventEmitter, throwOnTaskNotPassed: true }).toPromise()

  await expect(getImageTags(getResources().packages.package1.name)).resolves.toEqual(['1.0.0'])
})

test('scheduled and running events are fired', async () => {
  const scheduled = jest.fn()
  const running = jest.fn()

  taskQueue.eventEmitter.addListener(ExecutionStatus.scheduled, scheduled)
  taskQueue.eventEmitter.addListener(ExecutionStatus.running, running)

  const [{ taskId }] = taskQueue.addTasksToQueue([
    {
      packageName: getResources().packages.package1.name,
      repoName: distructPackageJsonName(getResources().packages.package1.name).name,
      visibility: 'public',
      imageTags: ['1.0.0'],
      relativeContextPath: '/',
      relativeDockerfilePath: getResources().packages.package1.relativeDockerFilePath,
      taskTimeoutMs: 10000,
    },
  ])

  await toTaskEvent$(taskId, { eventEmitter: taskQueue.eventEmitter, throwOnTaskNotPassed: true }).toPromise()

  expect(scheduled).toHaveBeenCalledTimes(1)
  expect(running).toHaveBeenCalledTimes(1)
})

test('illegal parameter - relativeContextPath', async () => {
  expect(() =>
    taskQueue.addTasksToQueue([
      {
        packageName: getResources().packages.package1.name,
        repoName: distructPackageJsonName(getResources().packages.package1.name).name,
        visibility: 'public',
        imageTags: ['1.0.0'],
        relativeContextPath: '/invalid-path-to-context',
        relativeDockerfilePath: getResources().packages.package1.relativeDockerFilePath,
        taskTimeoutMs: 10000,
      },
    ]),
  ).toThrow()
})

test('illegal parameter - relativeDockerfilePath', async () => {
  expect(() =>
    taskQueue.addTasksToQueue([
      {
        packageName: getResources().packages.package1.name,
        repoName: distructPackageJsonName(getResources().packages.package1.name).name,
        visibility: 'public',
        imageTags: ['1.0.0'],
        relativeContextPath: '/',
        relativeDockerfilePath: '/invalid-path-to-context',
        taskTimeoutMs: 10000,
      },
    ]),
  ).toThrow()
})

test('events are fired even when task failed', async () => {
  const scheduled = jest.fn()
  const running = jest.fn()

  taskQueue.eventEmitter.addListener(ExecutionStatus.scheduled, scheduled)
  taskQueue.eventEmitter.addListener(ExecutionStatus.running, running)

  await fs.promises.writeFile(
    path.join(getResources().repoPath, getResources().packages.package1.relativeDockerFilePath),
    `
FROM alpine
RUN exit 1
  `,
  )

  const [{ taskId }] = taskQueue.addTasksToQueue([
    {
      packageName: getResources().packages.package1.name,
      repoName: distructPackageJsonName(getResources().packages.package1.name).name,
      visibility: 'public',
      imageTags: ['1.0.0'],
      relativeContextPath: '/',
      relativeDockerfilePath: getResources().packages.package1.relativeDockerFilePath,
      taskTimeoutMs: 10000,
    },
  ])

  const doneEvent = await toTaskEvent$(taskId, { eventEmitter: taskQueue.eventEmitter, throwOnTaskNotPassed: false })
    .pipe(
      first(e => e.taskExecutionStatus === ExecutionStatus.done),
      map(e => e as DoneTask<QuayBuildsTaskPayload>),
    )
    .toPromise()

  expect(scheduled).toHaveBeenCalledTimes(1)
  expect(running).toHaveBeenCalledTimes(1)
  expect(doneEvent.taskResult.status).toEqual(Status.failed)
})

test('events schema is valid', async () => {
  const [{ taskId }] = taskQueue.addTasksToQueue([
    {
      packageName: getResources().packages.package1.name,
      repoName: distructPackageJsonName(getResources().packages.package1.name).name,
      visibility: 'public',
      imageTags: ['1.0.0'],
      relativeContextPath: '/',
      relativeDockerfilePath: getResources().packages.package1.relativeDockerFilePath,
      taskTimeoutMs: 10000,
    },
  ])

  const [scheduled, running, done] = await toTaskEvent$(taskId, {
    eventEmitter: taskQueue.eventEmitter,
    throwOnTaskNotPassed: true,
  })
    .pipe(
      toArray(),
      map(array => [
        array[0] as ScheduledTask<QuayBuildsTaskPayload>,
        array[1] as RunningTask<QuayBuildsTaskPayload>,
        array[2] as DoneTask<QuayBuildsTaskPayload>,
      ]),
    )
    .toPromise()

  expect(
    isDeepSubset(scheduled, {
      taskExecutionStatus: ExecutionStatus.scheduled,
      taskResult: {
        executionStatus: ExecutionStatus.scheduled,
      },
    }),
  ).toBeTruthy()

  expect(
    isDeepSubset(running, {
      taskExecutionStatus: ExecutionStatus.running,
      taskResult: {
        executionStatus: ExecutionStatus.running,
      },
    }),
  ).toBeTruthy()

  expect(
    isDeepSubset(done, {
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
  await fs.promises.writeFile(
    path.join(getResources().repoPath, getResources().packages.package1.relativeDockerFilePath),
    `
FROM alpine
RUN exit 1
  `,
  )

  const [{ taskId }] = taskQueue.addTasksToQueue([
    {
      packageName: getResources().packages.package1.name,
      repoName: distructPackageJsonName(getResources().packages.package1.name).name,
      visibility: 'public',
      imageTags: ['1.0.0'],
      relativeContextPath: '/',
      relativeDockerfilePath: getResources().packages.package1.relativeDockerFilePath,
      taskTimeoutMs: 10000,
    },
  ])

  const done = await toTaskEvent$(taskId, { eventEmitter: taskQueue.eventEmitter, throwOnTaskNotPassed: false })
    .pipe(
      first(e => e.taskExecutionStatus === ExecutionStatus.done),
      map(e => e as DoneTask<QuayBuildsTaskPayload>),
    )
    .toPromise()

  expect(
    isDeepSubset(done, {
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

test('abort event is fired for all tasks when queue is cleaned (before the tasks are executed)', async () => {
  const scheduled = jest.fn()
  const running = jest.fn()
  const aborted = jest.fn()

  taskQueue.eventEmitter.addListener(ExecutionStatus.scheduled, scheduled)
  taskQueue.eventEmitter.addListener(ExecutionStatus.running, running)
  taskQueue.eventEmitter.addListener(ExecutionStatus.aborted, aborted)

  taskQueue.addTasksToQueue([
    {
      packageName: getResources().packages.package1.name,
      repoName: distructPackageJsonName(getResources().packages.package1.name).name,
      visibility: 'public',
      imageTags: ['1.0.0'],
      relativeContextPath: '/',
      relativeDockerfilePath: getResources().packages.package1.relativeDockerFilePath,
      taskTimeoutMs: 10000,
    },
    {
      packageName: getResources().packages.package2.name,
      repoName: getResources().packages.package2.name,
      visibility: 'public',
      imageTags: ['1.0.0'],
      relativeContextPath: '/',
      relativeDockerfilePath: getResources().packages.package2.relativeDockerFilePath,
      taskTimeoutMs: 10000,
    },
  ])

  await taskQueue.cleanup()

  expect(scheduled).toHaveBeenCalledTimes(2)
  expect(running).toHaveBeenCalledTimes(0)
  expect(aborted).toHaveBeenCalledTimes(2)

  await expect(getImageTags(getResources().packages.package1.name)).resolves.toEqual([])
  await expect(getImageTags(getResources().packages.package2.name)).resolves.toEqual([])
})

test('abort event is fired for running tasks - while dockerfile is built', async () => {
  const aborted = jest.fn()

  taskQueue.eventEmitter.addListener(ExecutionStatus.aborted, aborted)

  await fs.promises.writeFile(
    path.join(getResources().repoPath, getResources().packages.package1.relativeDockerFilePath),
    `
FROM alpine
RUN sleep 10000 # make sure that this task will not end
  `,
  )

  const [{ taskId }] = taskQueue.addTasksToQueue([
    {
      packageName: getResources().packages.package1.name,
      repoName: distructPackageJsonName(getResources().packages.package1.name).name,
      visibility: 'public',
      imageTags: ['1.0.0'],
      relativeContextPath: '/',
      relativeDockerfilePath: getResources().packages.package1.relativeDockerFilePath,
      taskTimeoutMs: 10000,
    },
  ])

  await toTaskEvent$(taskId, { eventEmitter: taskQueue.eventEmitter, throwOnTaskNotPassed: false })
    .pipe(first(e => e.taskExecutionStatus === ExecutionStatus.running))
    .toPromise()

  // wait until the docker-build will start in quay-mock-service (we don't have event for that)
  await new Promise(res => setTimeout(res, 3000))

  await taskQueue.cleanup()

  expect(aborted).toHaveBeenCalledTimes(1)
})

test('abort events schema is valid', async () => {
  await fs.promises.writeFile(
    path.join(getResources().repoPath, getResources().packages.package1.relativeDockerFilePath),
    `
FROM alpine
RUN sleep 10000 # make sure that this task will not end
  `,
  )

  const [{ taskId }] = taskQueue.addTasksToQueue([
    {
      packageName: getResources().packages.package1.name,
      repoName: distructPackageJsonName(getResources().packages.package1.name).name,
      visibility: 'public',
      imageTags: ['1.0.0'],
      relativeContextPath: '/',
      relativeDockerfilePath: getResources().packages.package1.relativeDockerFilePath,
      taskTimeoutMs: 10000,
    },
  ])

  await toTaskEvent$(taskId, { eventEmitter: taskQueue.eventEmitter, throwOnTaskNotPassed: false })
    .pipe(first(e => e.taskExecutionStatus === ExecutionStatus.running))
    .toPromise()

  // I'm not awaiting because i don't want to miss the abored-event
  taskQueue.cleanup()

  const abort = await toTaskEvent$(taskId, { eventEmitter: taskQueue.eventEmitter, throwOnTaskNotPassed: false })
    .pipe(
      first(e => e.taskExecutionStatus === ExecutionStatus.aborted),
      map(e => e as AbortedTask<QuayBuildsTaskPayload>),
    )
    .toPromise()

  expect(
    isDeepSubset(abort, {
      taskExecutionStatus: ExecutionStatus.aborted,
      taskResult: {
        executionStatus: ExecutionStatus.aborted,
        status: Status.skippedAsFailed,
        notes: [],
        errors: [],
      },
    }),
  ).toBeTruthy()
})

test('multiple tasks', async () => {
  const tasks = taskQueue.addTasksToQueue(
    Object.values(getResources().packages).map((packageInfo, i) => ({
      packageName: packageInfo.name,
      repoName: distructPackageJsonName(packageInfo.name).name,
      visibility: 'public',
      imageTags: [`1.0.${i}`],
      relativeContextPath: '/',
      relativeDockerfilePath: packageInfo.relativeDockerFilePath,
      taskTimeoutMs: 100_000,
    })),
  )

  await merge(
    ...tasks.map(task =>
      toTaskEvent$(task.taskId, { eventEmitter: taskQueue.eventEmitter, throwOnTaskNotPassed: true }),
    ),
  ).toPromise()

  for (const [i, packageInfo] of Object.values(getResources().packages).entries()) {
    await expect(getImageTags(packageInfo.name)).resolves.toEqual([`1.0.${i}`])
  }
})
