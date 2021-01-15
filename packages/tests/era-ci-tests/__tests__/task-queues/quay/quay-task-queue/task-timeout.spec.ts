import { AbortedTask, toTaskEvent$ } from '@era-ci/core'
import { QuayBuildsTaskPayload } from '@era-ci/task-queues'
import { distructPackageJsonName, ExecutionStatus } from '@era-ci/utils'
import expect from 'expect'
import fs from 'fs'
import path from 'path'
import { firstValueFrom } from 'rxjs'
import { first, map } from 'rxjs/operators'
import { beforeAfterEach, test } from '../utils'

beforeAfterEach(test, {
  quayMockService: {
    rateLimit: {
      max: 1,
      timeWindowMs: 1000,
    },
  },
})

test('ensure task is aborted when it reaches timeout (while the retry mechanism is running)', async t => {
  const [{ taskId }] = t.context.taskQueuesResources.queue.addTasksToQueue([
    {
      packageName: t.context.packages.package1.name,
      repoName: distructPackageJsonName(t.context.packages.package1.name).name,
      visibility: 'public',
      imageTags: ['1.0.0'],
      relativeContextPath: '/',
      relativeDockerfilePath: t.context.packages.package1.relativeDockerFilePath,
      taskTimeoutMs: 1500,
    },
  ])

  const aborted = await firstValueFrom(
    toTaskEvent$(taskId, {
      eventEmitter: t.context.taskQueuesResources.queue.eventEmitter,
      throwOnTaskNotPassed: false,
    }).pipe(
      first(e => e.taskExecutionStatus === ExecutionStatus.aborted),
      map(e => e as AbortedTask<QuayBuildsTaskPayload>),
    ),
  )

  expect(aborted.taskResult.notes).toEqual(['task-timeout'])
})

test('ensure task is aborted when it reaches timeout (while the docker-build is running)', async t => {
  await fs.promises.writeFile(
    path.join(t.context.taskQueuesResources.repoPath, t.context.packages.package1.relativeDockerFilePath),
    `
FROM alpine
RUN sleep 10000 # make sure that this task will not end
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
      taskTimeoutMs: 3000,
    },
  ])

  const aborted = await firstValueFrom(
    toTaskEvent$(taskId, {
      eventEmitter: t.context.taskQueuesResources.queue.eventEmitter,
      throwOnTaskNotPassed: false,
    }).pipe(
      first(e => e.taskExecutionStatus === ExecutionStatus.aborted),
      map(e => e as AbortedTask<QuayBuildsTaskPayload>),
    ),
  )

  expect(aborted.taskResult.notes).toEqual(['task-timeout'])
})
