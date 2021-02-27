import { AbortedTask, toTaskEvent$ } from '@era-ci/core'
import { QuayBuildsTaskPayload } from '@era-ci/task-queues'
import { distructPackageJsonName, ExecutionStatus } from '@era-ci/utils'
import { test, expect } from '@jest/globals'
import fs from 'fs'
import path from 'path'
import { firstValueFrom } from 'rxjs'
import { first, map } from 'rxjs/operators'
import { beforeAfterEach } from '../utils'

const { getResources } = beforeAfterEach({
  quayMockService: {
    rateLimit: {
      max: 1,
      timeWindowMs: 1000,
    },
  },
})

test('ensure task is aborted when it reaches timeout (while the retry mechanism is running)', async () => {
  const [{ taskId }] = getResources().taskQueuesResources.queue.addTasksToQueue([
    {
      packageName: getResources().packages.package1.name,
      repoName: distructPackageJsonName(getResources().packages.package1.name).name,
      visibility: 'public',
      imageTags: ['1.0.0'],
      relativeContextPath: '',
      relativeDockerfilePath: getResources().packages.package1.relativeDockerFilePath,
      taskTimeoutMs: 1500,
    },
  ])

  const aborted = await firstValueFrom(
    toTaskEvent$(taskId, {
      eventEmitter: getResources().taskQueuesResources.queue.eventEmitter,
      throwOnTaskNotPassed: false,
    }).pipe(
      first(e => e.taskExecutionStatus === ExecutionStatus.aborted),
      map(e => e as AbortedTask<QuayBuildsTaskPayload>),
    ),
  )

  expect(aborted.taskResult.notes).toEqual(['task-timeout'])
})

test('ensure task is aborted when it reaches timeout (while the docker-build is running)', async () => {
  await fs.promises.writeFile(
    path.join(getResources().taskQueuesResources.repoPath, getResources().packages.package1.relativeDockerFilePath),
    `
FROM alpine
RUN sleep 10000 # make sure that this task will not end
  `,
  )

  const [{ taskId }] = getResources().taskQueuesResources.queue.addTasksToQueue([
    {
      packageName: getResources().packages.package1.name,
      repoName: distructPackageJsonName(getResources().packages.package1.name).name,
      visibility: 'public',
      imageTags: ['1.0.0'],
      relativeContextPath: '',
      relativeDockerfilePath: getResources().packages.package1.relativeDockerFilePath,
      taskTimeoutMs: 3000,
    },
  ])

  const aborted = await firstValueFrom(
    toTaskEvent$(taskId, {
      eventEmitter: getResources().taskQueuesResources.queue.eventEmitter,
      throwOnTaskNotPassed: false,
    }).pipe(
      first(e => e.taskExecutionStatus === ExecutionStatus.aborted),
      map(e => e as AbortedTask<QuayBuildsTaskPayload>),
    ),
  )

  expect(aborted.taskResult.notes).toEqual(['task-timeout'])
})
