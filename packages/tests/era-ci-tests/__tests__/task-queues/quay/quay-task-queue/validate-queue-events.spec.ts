import { AbortedTask, DoneTask, RunningTask, ScheduledTask, toTaskEvent$ } from '@era-ci/core'
import { isDeepSubset } from '@era-ci/e2e-tests-infra'
import { QuayBuildsTaskPayload } from '@era-ci/task-queues'
import { distructPackageJsonName, ExecutionStatus, Status } from '@era-ci/utils'
import fs from 'fs'
import path from 'path'
import { merge, firstValueFrom, lastValueFrom } from 'rxjs'
import { first, map, toArray } from 'rxjs/operators'
import sinon from 'sinon'
import { beforeAfterEach, test } from '../utils'
import expect from 'expect'

beforeAfterEach(test)

test('cleanup dont throw when queue is empty', async t => {
  // NOTE: this is the test. it's not a mistake!
  // ensure even if we don't use the queue, it won't throw errors.
})

test('can add zero length array', async t => {
  t.context.taskQueuesResources.queue.addTasksToQueue([])
})

test('cleanup can be called multiple times', async t => {
  await t.context.taskQueuesResources.queue.cleanup()
  await t.context.taskQueuesResources.queue.cleanup()
})

test('cant add tasks after cleanup', async t => {
  await t.context.taskQueuesResources.queue.cleanup()
  expect(() => t.context.taskQueuesResources.queue.addTasksToQueue([])).toThrow()
})

test('cleanup can be called multiple times concurrenctly', async t => {
  await Promise.all([t.context.taskQueuesResources.queue.cleanup(), t.context.taskQueuesResources.queue.cleanup()])
})

test('task is executed and we expect the docker-image to be presentin the registry', async t => {
  const [{ taskId }] = t.context.taskQueuesResources.queue.addTasksToQueue([
    {
      packageName: t.context.packages.package1.name,
      repoName: distructPackageJsonName(t.context.packages.package1.name).name,
      visibility: 'public',
      imageTags: ['1.0.0'],
      relativeContextPath: '/',
      relativeDockerfilePath: t.context.packages.package1.relativeDockerFilePath,
      taskTimeoutMs: 100_000,
    },
  ])

  await lastValueFrom(
    toTaskEvent$(taskId, {
      eventEmitter: t.context.taskQueuesResources.queue.eventEmitter,
      throwOnTaskNotPassed: true,
    }),
  )

  await expect(t.context.getImageTags(t.context.packages.package1.name)).resolves.toEqual(['1.0.0'])
})

test('scheduled and running events are fired', async t => {
  const scheduled = sinon.fake()
  const running = sinon.fake()

  t.context.taskQueuesResources.queue.eventEmitter.addListener(ExecutionStatus.scheduled, scheduled)
  t.context.taskQueuesResources.queue.eventEmitter.addListener(ExecutionStatus.running, running)

  const [{ taskId }] = t.context.taskQueuesResources.queue.addTasksToQueue([
    {
      packageName: t.context.packages.package1.name,
      repoName: distructPackageJsonName(t.context.packages.package1.name).name,
      visibility: 'public',
      imageTags: ['1.0.0'],
      relativeContextPath: '/',
      relativeDockerfilePath: t.context.packages.package1.relativeDockerFilePath,
      taskTimeoutMs: 100_000,
    },
  ])

  await lastValueFrom(
    toTaskEvent$(taskId, {
      eventEmitter: t.context.taskQueuesResources.queue.eventEmitter,
      throwOnTaskNotPassed: true,
    }),
  )

  expect(scheduled.calledOnce).toBeTruthy()
  expect(running.calledOnce).toBeTruthy()
})

test('illegal parameter - relativeContextPath', async t => {
  expect(() =>
    t.context.taskQueuesResources.queue.addTasksToQueue([
      {
        packageName: t.context.packages.package1.name,
        repoName: distructPackageJsonName(t.context.packages.package1.name).name,
        visibility: 'public',
        imageTags: ['1.0.0'],
        relativeContextPath: '/invalid-path-to-context',
        relativeDockerfilePath: t.context.packages.package1.relativeDockerFilePath,
        taskTimeoutMs: 100_000,
      },
    ]),
  ).toThrow()
})

test('illegal parameter - relativeDockerfilePath', async t => {
  expect(() =>
    t.context.taskQueuesResources.queue.addTasksToQueue([
      {
        packageName: t.context.packages.package1.name,
        repoName: distructPackageJsonName(t.context.packages.package1.name).name,
        visibility: 'public',
        imageTags: ['1.0.0'],
        relativeContextPath: '/',
        relativeDockerfilePath: '/invalid-path-to-context',
        taskTimeoutMs: 100_000,
      },
    ]),
  ).toThrow()
})

test('events are fired even when task failed', async t => {
  const scheduled = sinon.fake()
  const running = sinon.fake()

  t.context.taskQueuesResources.queue.eventEmitter.addListener(ExecutionStatus.scheduled, scheduled)
  t.context.taskQueuesResources.queue.eventEmitter.addListener(ExecutionStatus.running, running)

  await fs.promises.writeFile(
    path.join(t.context.taskQueuesResources.repoPath, t.context.packages.package1.relativeDockerFilePath),
    `
FROM alpine
RUN exit 1
  `,
  )

  const [{ taskId }] = t.context.taskQueuesResources.queue.addTasksToQueue([
    {
      packageName: t.context.packages.package1.name,
      repoName: distructPackageJsonName(t.context.packages.package1.name).name,
      visibility: 'public',
      imageTags: ['1.0.0'],
      relativeContextPath: '/',
      relativeDockerfilePath: t.context.packages.package1.relativeDockerFilePath,
      taskTimeoutMs: 100_000,
    },
  ])

  const doneEvent = await firstValueFrom(
    toTaskEvent$(taskId, {
      eventEmitter: t.context.taskQueuesResources.queue.eventEmitter,
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

test('events schema is valid', async t => {
  const [{ taskId }] = t.context.taskQueuesResources.queue.addTasksToQueue([
    {
      packageName: t.context.packages.package1.name,
      repoName: distructPackageJsonName(t.context.packages.package1.name).name,
      visibility: 'public',
      imageTags: ['1.0.0'],
      relativeContextPath: '/',
      relativeDockerfilePath: t.context.packages.package1.relativeDockerFilePath,
      taskTimeoutMs: 100_000,
    },
  ])

  const [scheduled, running, done] = await lastValueFrom(
    toTaskEvent$(taskId, {
      eventEmitter: t.context.taskQueuesResources.queue.eventEmitter,
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
    isDeepSubset(t, scheduled, {
      taskExecutionStatus: ExecutionStatus.scheduled,
      taskResult: {
        executionStatus: ExecutionStatus.scheduled,
      },
    }),
  ).toBeTruthy()

  expect(
    isDeepSubset(t, running, {
      taskExecutionStatus: ExecutionStatus.running,
      taskResult: {
        executionStatus: ExecutionStatus.running,
      },
    }),
  ).toBeTruthy()

  expect(
    isDeepSubset(t, done, {
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

test('done events schema is valid when task fail', async t => {
  await fs.promises.writeFile(
    path.join(t.context.taskQueuesResources.repoPath, t.context.packages.package1.relativeDockerFilePath),
    `
FROM alpine
RUN exit 1
  `,
  )

  const [{ taskId }] = t.context.taskQueuesResources.queue.addTasksToQueue([
    {
      packageName: t.context.packages.package1.name,
      repoName: distructPackageJsonName(t.context.packages.package1.name).name,
      visibility: 'public',
      imageTags: ['1.0.0'],
      relativeContextPath: '/',
      relativeDockerfilePath: t.context.packages.package1.relativeDockerFilePath,
      taskTimeoutMs: 100_000,
    },
  ])

  const done = await firstValueFrom(
    toTaskEvent$(taskId, {
      eventEmitter: t.context.taskQueuesResources.queue.eventEmitter,
      throwOnTaskNotPassed: false,
    }).pipe(
      first(e => e.taskExecutionStatus === ExecutionStatus.done),
      map(e => e as DoneTask<QuayBuildsTaskPayload>),
    ),
  )

  expect(
    isDeepSubset(t, done, {
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

test('abort event is fired for all tasks when queue is cleaned (before the tasks are executed)', async t => {
  const scheduled = sinon.fake()
  const running = sinon.fake()
  const aborted = sinon.fake()

  t.context.taskQueuesResources.queue.eventEmitter.addListener(ExecutionStatus.scheduled, scheduled)
  t.context.taskQueuesResources.queue.eventEmitter.addListener(ExecutionStatus.running, running)
  t.context.taskQueuesResources.queue.eventEmitter.addListener(ExecutionStatus.aborted, aborted)

  t.context.taskQueuesResources.queue.addTasksToQueue([
    {
      packageName: t.context.packages.package1.name,
      repoName: distructPackageJsonName(t.context.packages.package1.name).name,
      visibility: 'public',
      imageTags: ['1.0.0'],
      relativeContextPath: '/',
      relativeDockerfilePath: t.context.packages.package1.relativeDockerFilePath,
      taskTimeoutMs: 100_000,
    },
    {
      packageName: t.context.packages.package2.name,
      repoName: t.context.packages.package2.name,
      visibility: 'public',
      imageTags: ['1.0.0'],
      relativeContextPath: '/',
      relativeDockerfilePath: t.context.packages.package2.relativeDockerFilePath,
      taskTimeoutMs: 100_000,
    },
  ])

  await t.context.taskQueuesResources.queue.cleanup()

  expect(scheduled.calledTwice).toBeTruthy()
  expect(running.notCalled).toBeTruthy()
  expect(aborted.calledTwice).toBeTruthy()

  await expect(t.context.getImageTags(t.context.packages.package1.name)).resolves.toEqual([])
  await expect(t.context.getImageTags(t.context.packages.package2.name)).resolves.toEqual([])
})

test('abort event is fired for running tasks - while dockerfile is built', async t => {
  const aborted = sinon.fake()

  t.context.taskQueuesResources.queue.eventEmitter.addListener(ExecutionStatus.aborted, aborted)

  await fs.promises.writeFile(
    path.join(t.context.taskQueuesResources.repoPath, t.context.packages.package1.relativeDockerFilePath),
    `
FROM alpine
RUN sleep 1000 # make sure that this task will not end
  `,
  )

  const [{ taskId }] = t.context.taskQueuesResources.queue.addTasksToQueue([
    {
      packageName: t.context.packages.package1.name,
      repoName: distructPackageJsonName(t.context.packages.package1.name).name,
      visibility: 'public',
      imageTags: ['1.0.0'],
      relativeContextPath: '/',
      relativeDockerfilePath: t.context.packages.package1.relativeDockerFilePath,
      taskTimeoutMs: 100_000,
    },
  ])

  await firstValueFrom(
    toTaskEvent$(taskId, {
      eventEmitter: t.context.taskQueuesResources.queue.eventEmitter,
      throwOnTaskNotPassed: false,
    }).pipe(first(e => e.taskExecutionStatus === ExecutionStatus.running)),
  )

  // wait until the docker-build will start in quay-mock-service (we don't have event for that)
  await new Promise(res => setTimeout(res, 3000))

  await t.context.taskQueuesResources.queue.cleanup()

  expect(aborted.calledOnce).toBeTruthy()
})

test('abort events schema is valid', async t => {
  await fs.promises.writeFile(
    path.join(t.context.taskQueuesResources.repoPath, t.context.packages.package1.relativeDockerFilePath),
    `
FROM alpine
RUN sleep 100_000 # make sure that this task will not end
  `,
  )

  const [{ taskId }] = t.context.taskQueuesResources.queue.addTasksToQueue([
    {
      packageName: t.context.packages.package1.name,
      repoName: distructPackageJsonName(t.context.packages.package1.name).name,
      visibility: 'public',
      imageTags: ['1.0.0'],
      relativeContextPath: '/',
      relativeDockerfilePath: t.context.packages.package1.relativeDockerFilePath,
      taskTimeoutMs: 100_000,
    },
  ])

  await firstValueFrom(
    toTaskEvent$(taskId, {
      eventEmitter: t.context.taskQueuesResources.queue.eventEmitter,
      throwOnTaskNotPassed: false,
    }).pipe(first(e => e.taskExecutionStatus === ExecutionStatus.running)),
  )

  // I'm not awaiting because i don't want to miss the abored-event
  t.context.taskQueuesResources.queue.cleanup()

  const abort = await firstValueFrom(
    toTaskEvent$(taskId, {
      eventEmitter: t.context.taskQueuesResources.queue.eventEmitter,
      throwOnTaskNotPassed: false,
    }).pipe(
      first(e => e.taskExecutionStatus === ExecutionStatus.aborted),
      map(e => e as AbortedTask<QuayBuildsTaskPayload>),
    ),
  )

  expect(
    isDeepSubset(t, abort, {
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

test('multiple tasks', async t => {
  const tasks = t.context.taskQueuesResources.queue.addTasksToQueue(
    Object.values(t.context.packages).map((packageInfo, i) => ({
      packageName: packageInfo.name,
      repoName: distructPackageJsonName(packageInfo.name).name,
      visibility: 'public',
      imageTags: [`1.0.${i}`],
      relativeContextPath: '/',
      relativeDockerfilePath: packageInfo.relativeDockerFilePath,
      taskTimeoutMs: 100_000,
    })),
  )

  await lastValueFrom(
    merge(
      ...tasks.map(task =>
        toTaskEvent$(task.taskId, {
          eventEmitter: t.context.taskQueuesResources.queue.eventEmitter,
          throwOnTaskNotPassed: true,
        }),
      ),
    ),
  )

  for (const [i, packageInfo] of Object.values(t.context.packages).entries()) {
    await expect(t.context.getImageTags(packageInfo.name)).resolves.toEqual([`1.0.${i}`])
  }
})
