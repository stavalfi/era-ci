import { AbortedTask, toTaskEvent$ } from '@tahini/core'
import { ExecutionStatus } from '@tahini/utils'
import { QuayBuildsTaskQueue } from '@tahini/task-queues'
import path from 'path'
import fs from 'fs'
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

let taskQueue: QuayBuildsTaskQueue

beforeEach(() => {
  taskQueue = getResources().queue
})

test('ensure task is aborted when it reaches timeout (while the retry mechanism is running)', async () => {
  const [{ taskId }] = taskQueue.addTasksToQueue([
    {
      packageName: getResources().packages.package1.name,
      repoName: getResources().packages.package1.name,
      visibility: 'public',
      imageTags: ['1.0.0'],
      relativeContextPath: '/',
      relativeDockerfilePath: getResources().packages.package1.relativeDockerFilePath,
      taskTimeoutMs: 1500,
    },
  ])

  const aborted = await toTaskEvent$(taskId, { eventEmitter: taskQueue.eventEmitter, throwOnTaskNotPassed: false })
    .pipe(
      first(e => e.taskExecutionStatus === ExecutionStatus.aborted),
      map(e => e as AbortedTask),
    )
    .toPromise()

  expect(aborted.taskResult.notes).toEqual(['task-timeout'])
})

test('ensure task is aborted when it reaches timeout (while the docker-build is running)', async () => {
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
      repoName: getResources().packages.package1.name,
      visibility: 'public',
      imageTags: ['1.0.0'],
      relativeContextPath: '/',
      relativeDockerfilePath: getResources().packages.package1.relativeDockerFilePath,
      taskTimeoutMs: 3000,
    },
  ])

  const aborted = await toTaskEvent$(taskId, { eventEmitter: taskQueue.eventEmitter, throwOnTaskNotPassed: false })
    .pipe(
      first(e => e.taskExecutionStatus === ExecutionStatus.aborted),
      map(e => e as AbortedTask),
    )
    .toPromise()

  expect(aborted.taskResult.notes).toEqual(['task-timeout'])
})
