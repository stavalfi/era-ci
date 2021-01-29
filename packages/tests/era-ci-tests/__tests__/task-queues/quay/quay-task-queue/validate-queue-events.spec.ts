import { AbortedTask, DoneTask, RunningTask, ScheduledTask, toTaskEvent$ } from '@era-ci/core'
import { isDeepSubset } from '@era-ci/e2e-tests-infra'
import { QuayBuildsTaskPayload } from '@era-ci/task-queues'
import { distructPackageJsonName, ExecutionStatus, firstValueFrom, lastValueFrom, Status } from '@era-ci/utils'
import expect from 'expect'
import fs from 'fs'
import path from 'path'
import { merge } from 'rxjs'
import { first, map, toArray } from 'rxjs/operators'
import sinon from 'sinon'
import { beforeAfterEach } from '../utils'

const { getResources } = beforeAfterEach()

test('cleanup dont throw when queue is empty', async () => {
  // NOTE: this is the test. it's not a mistake!
  // ensure even if we don't use the queue, it won't throw errors.
})

test('can add zero length array', async () => {
  getResources().taskQueuesResources.queue.addTasksToQueue([])
})

test('cleanup can be called multiple times', async () => {
  await getResources().taskQueuesResources.queue.cleanup()
  await getResources().taskQueuesResources.queue.cleanup()
})

test('cant add tasks after cleanup', async () => {
  await getResources().taskQueuesResources.queue.cleanup()
  expect(() => getResources().taskQueuesResources.queue.addTasksToQueue([])).toThrow()
})

test('cleanup can be called multiple times concurrenctly', async () => {
  await Promise.all([
    getResources().taskQueuesResources.queue.cleanup(),
    getResources().taskQueuesResources.queue.cleanup(),
  ])
})

test('task is executed and we expect the docker-image to be presentin the registry', async () => {
  const [{ taskId }] = getResources().taskQueuesResources.queue.addTasksToQueue([
    {
      packageName: getResources().packages.package1.name,
      repoName: distructPackageJsonName(getResources().packages.package1.name).name,
      visibility: 'public',
      imageTags: ['1.0.0'],
      relativeContextPath: '/',
      relativeDockerfilePath: getResources().packages.package1.relativeDockerFilePath,
      taskTimeoutMs: 10000_000,
    },
  ])

  await lastValueFrom(
    toTaskEvent$(taskId, {
      eventEmitter: getResources().taskQueuesResources.queue.eventEmitter,
      throwOnTaskNotPassed: true,
    }),
  )

  await expect(getResources().getImageTags(getResources().packages.package1.name)).resolves.toEqual(['1.0.0'])
})

test('scheduled and running events are fired', async () => {
  const scheduled = sinon.fake()
  const running = sinon.fake()

  getResources().taskQueuesResources.queue.eventEmitter.addListener(ExecutionStatus.scheduled, scheduled)
  getResources().taskQueuesResources.queue.eventEmitter.addListener(ExecutionStatus.running, running)

  const [{ taskId }] = getResources().taskQueuesResources.queue.addTasksToQueue([
    {
      packageName: getResources().packages.package1.name,
      repoName: distructPackageJsonName(getResources().packages.package1.name).name,
      visibility: 'public',
      imageTags: ['1.0.0'],
      relativeContextPath: '/',
      relativeDockerfilePath: getResources().packages.package1.relativeDockerFilePath,
      taskTimeoutMs: 10_000,
    },
  ])

  await lastValueFrom(
    toTaskEvent$(taskId, {
      eventEmitter: getResources().taskQueuesResources.queue.eventEmitter,
      throwOnTaskNotPassed: true,
    }),
  )

  expect(scheduled.calledOnce).toBeTruthy()
  expect(running.calledOnce).toBeTruthy()
})

test('illegal parameter - relativeContextPath', async () => {
  expect(() =>
    getResources().taskQueuesResources.queue.addTasksToQueue([
      {
        packageName: getResources().packages.package1.name,
        repoName: distructPackageJsonName(getResources().packages.package1.name).name,
        visibility: 'public',
        imageTags: ['1.0.0'],
        relativeContextPath: '/invalid-path-to-context',
        relativeDockerfilePath: getResources().packages.package1.relativeDockerFilePath,
        taskTimeoutMs: 10_000,
      },
    ]),
  ).toThrow()
})

test('illegal parameter - relativeDockerfilePath', async () => {
  expect(() =>
    getResources().taskQueuesResources.queue.addTasksToQueue([
      {
        packageName: getResources().packages.package1.name,
        repoName: distructPackageJsonName(getResources().packages.package1.name).name,
        visibility: 'public',
        imageTags: ['1.0.0'],
        relativeContextPath: '/',
        relativeDockerfilePath: '/invalid-path-to-context',
        taskTimeoutMs: 10_000,
      },
    ]),
  ).toThrow()
})

test('events are fired even when task failed', async () => {
  const scheduled = sinon.fake()
  const running = sinon.fake()

  getResources().taskQueuesResources.queue.eventEmitter.addListener(ExecutionStatus.scheduled, scheduled)
  getResources().taskQueuesResources.queue.eventEmitter.addListener(ExecutionStatus.running, running)

  await fs.promises.writeFile(
    path.join(getResources().taskQueuesResources.repoPath, getResources().packages.package1.relativeDockerFilePath),
    `
FROM alpine
RUN exit 1
  `,
  )

  const [{ taskId }] = getResources().taskQueuesResources.queue.addTasksToQueue([
    {
      packageName: getResources().packages.package1.name,
      repoName: distructPackageJsonName(getResources().packages.package1.name).name,
      visibility: 'public',
      imageTags: ['1.0.0'],
      relativeContextPath: '/',
      relativeDockerfilePath: getResources().packages.package1.relativeDockerFilePath,
      taskTimeoutMs: 10_000,
    },
  ])

  const doneEvent = await firstValueFrom(
    toTaskEvent$(taskId, {
      eventEmitter: getResources().taskQueuesResources.queue.eventEmitter,
      throwOnTaskNotPassed: false,
    }).pipe(
      first(e => e.taskExecutionStatus === ExecutionStatus.done),
      map(e => e as DoneTask<QuayBuildsTaskPayload>),
    ),
  )

  expect(scheduled.calledOnce).toBeTruthy()
  expect(running.calledOnce).toBeTruthy()
  expect(doneEvent.taskResult.status).toEqual(Status.failed)
})

test('events schema is valid', async () => {
  const [{ taskId }] = getResources().taskQueuesResources.queue.addTasksToQueue([
    {
      packageName: getResources().packages.package1.name,
      repoName: distructPackageJsonName(getResources().packages.package1.name).name,
      visibility: 'public',
      imageTags: ['1.0.0'],
      relativeContextPath: '/',
      relativeDockerfilePath: getResources().packages.package1.relativeDockerFilePath,
      taskTimeoutMs: 10_000,
    },
  ])

  const [scheduled, running, done] = await lastValueFrom(
    toTaskEvent$(taskId, {
      eventEmitter: getResources().taskQueuesResources.queue.eventEmitter,
      throwOnTaskNotPassed: true,
    }).pipe(
      toArray(),
      map(array => [
        array[0] as ScheduledTask<QuayBuildsTaskPayload>,
        array[1] as RunningTask<QuayBuildsTaskPayload>,
        array[2] as DoneTask<QuayBuildsTaskPayload>,
      ]),
    ),
  )

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
    path.join(getResources().taskQueuesResources.repoPath, getResources().packages.package1.relativeDockerFilePath),
    `
FROM alpine
RUN exit 1
  `,
  )

  const [{ taskId }] = getResources().taskQueuesResources.queue.addTasksToQueue([
    {
      packageName: getResources().packages.package1.name,
      repoName: distructPackageJsonName(getResources().packages.package1.name).name,
      visibility: 'public',
      imageTags: ['1.0.0'],
      relativeContextPath: '/',
      relativeDockerfilePath: getResources().packages.package1.relativeDockerFilePath,
      taskTimeoutMs: 10_000,
    },
  ])

  const done = await firstValueFrom(
    toTaskEvent$(taskId, {
      eventEmitter: getResources().taskQueuesResources.queue.eventEmitter,
      throwOnTaskNotPassed: false,
    }).pipe(
      first(e => e.taskExecutionStatus === ExecutionStatus.done),
      map(e => e as DoneTask<QuayBuildsTaskPayload>),
    ),
  )

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
  const scheduled = sinon.fake()
  const running = sinon.fake()
  const aborted = sinon.fake()

  getResources().taskQueuesResources.queue.eventEmitter.addListener(ExecutionStatus.scheduled, scheduled)
  getResources().taskQueuesResources.queue.eventEmitter.addListener(ExecutionStatus.running, running)
  getResources().taskQueuesResources.queue.eventEmitter.addListener(ExecutionStatus.aborted, aborted)

  getResources().taskQueuesResources.queue.addTasksToQueue([
    {
      packageName: getResources().packages.package1.name,
      repoName: distructPackageJsonName(getResources().packages.package1.name).name,
      visibility: 'public',
      imageTags: ['1.0.0'],
      relativeContextPath: '/',
      relativeDockerfilePath: getResources().packages.package1.relativeDockerFilePath,
      taskTimeoutMs: 10_000,
    },
    {
      packageName: getResources().packages.package2.name,
      repoName: getResources().packages.package2.name,
      visibility: 'public',
      imageTags: ['1.0.0'],
      relativeContextPath: '/',
      relativeDockerfilePath: getResources().packages.package2.relativeDockerFilePath,
      taskTimeoutMs: 10_000,
    },
  ])

  await getResources().taskQueuesResources.queue.cleanup()

  expect(scheduled.calledTwice).toBeTruthy()
  expect(running.notCalled).toBeTruthy()
  expect(aborted.calledTwice).toBeTruthy()

  await expect(getResources().getImageTags(getResources().packages.package1.name)).resolves.toEqual([])
  await expect(getResources().getImageTags(getResources().packages.package2.name)).resolves.toEqual([])
})

test('abort event is fired for running tasks - while dockerfile is built', async () => {
  const aborted = sinon.fake()

  getResources().taskQueuesResources.queue.eventEmitter.addListener(ExecutionStatus.aborted, aborted)

  await fs.promises.writeFile(
    path.join(getResources().taskQueuesResources.repoPath, getResources().packages.package1.relativeDockerFilePath),
    `
FROM alpine
RUN sleep 1000 # make sure that this task will not end
  `,
  )

  const [{ taskId }] = getResources().taskQueuesResources.queue.addTasksToQueue([
    {
      packageName: getResources().packages.package1.name,
      repoName: distructPackageJsonName(getResources().packages.package1.name).name,
      visibility: 'public',
      imageTags: ['1.0.0'],
      relativeContextPath: '/',
      relativeDockerfilePath: getResources().packages.package1.relativeDockerFilePath,
      taskTimeoutMs: 10_000,
    },
  ])

  await firstValueFrom(
    toTaskEvent$(taskId, {
      eventEmitter: getResources().taskQueuesResources.queue.eventEmitter,
      throwOnTaskNotPassed: false,
    }).pipe(first(e => e.taskExecutionStatus === ExecutionStatus.running)),
  )

  // wait until the docker-build will start in quay-mock-service (we don't have event for that)
  await new Promise(res => setTimeout(res, 3000))

  await getResources().taskQueuesResources.queue.cleanup()

  expect(aborted.calledOnce).toBeTruthy()
})

test('abort events schema is valid', async () => {
  await fs.promises.writeFile(
    path.join(getResources().taskQueuesResources.repoPath, getResources().packages.package1.relativeDockerFilePath),
    `
FROM alpine
RUN sleep 10_000 # make sure that this task will not end
  `,
  )

  const [{ taskId }] = getResources().taskQueuesResources.queue.addTasksToQueue([
    {
      packageName: getResources().packages.package1.name,
      repoName: distructPackageJsonName(getResources().packages.package1.name).name,
      visibility: 'public',
      imageTags: ['1.0.0'],
      relativeContextPath: '/',
      relativeDockerfilePath: getResources().packages.package1.relativeDockerFilePath,
      taskTimeoutMs: 10_000,
    },
  ])

  await firstValueFrom(
    toTaskEvent$(taskId, {
      eventEmitter: getResources().taskQueuesResources.queue.eventEmitter,
      throwOnTaskNotPassed: false,
    }).pipe(first(e => e.taskExecutionStatus === ExecutionStatus.running)),
  )

  // I'm not awaiting because i don't want to miss the abored-event
  getResources().taskQueuesResources.queue.cleanup()

  const abort = await firstValueFrom(
    toTaskEvent$(taskId, {
      eventEmitter: getResources().taskQueuesResources.queue.eventEmitter,
      throwOnTaskNotPassed: false,
    }).pipe(
      first(e => e.taskExecutionStatus === ExecutionStatus.aborted),
      map(e => e as AbortedTask<QuayBuildsTaskPayload>),
    ),
  )

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
  const tasks = getResources().taskQueuesResources.queue.addTasksToQueue(
    Object.values(getResources().packages).map((packageInfo, i) => ({
      packageName: packageInfo.name,
      repoName: distructPackageJsonName(packageInfo.name).name,
      visibility: 'public',
      imageTags: [`1.0.${i}`],
      relativeContextPath: '/',
      relativeDockerfilePath: packageInfo.relativeDockerFilePath,
      taskTimeoutMs: 40_000, // eventually, quay-mock-service process one request at a time, so we need to give a big timeout for each task.
    })),
  )

  await lastValueFrom(
    merge(
      ...tasks.map(task =>
        toTaskEvent$(task.taskId, {
          eventEmitter: getResources().taskQueuesResources.queue.eventEmitter,
          throwOnTaskNotPassed: true,
        }),
      ),
    ),
  )

  for (const [i, packageInfo] of Object.values(getResources().packages).entries()) {
    await expect(getResources().getImageTags(packageInfo.name)).resolves.toEqual([`1.0.${i}`])
  }
})
