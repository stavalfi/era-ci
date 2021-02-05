import { AbortedTask, toTaskEvent$ } from '@era-ci/core'
import { QuayBuildsTaskPayload } from '@era-ci/task-queues'
import { distructPackageJsonName, ExecutionStatus, firstValueFrom } from '@era-ci/utils'
import expect from 'expect'
import { first, map, toArray } from 'rxjs/operators'
import { beforeAfterEach } from '../utils'

const { getResources } = beforeAfterEach({
  quayMockService: {
    rateLimit: {
      max: 1,
      timeWindowMs: 1000,
    },
  },
  getCommitTarGzPublicAddress: async () => {
    return {
      url: `http://lalaala-invalid-url:8080`,
      folderName: 'lala',
    }
  },
})

test('user provide tar gz to repository which is not exist - it can be because of unpushed commit or a typo or any other reason', async () => {
  const [{ taskId }] = getResources().taskQueuesResources.queue.addTasksToQueue([
    {
      packageName: getResources().packages.package1.name,
      repoName: distructPackageJsonName(getResources().packages.package1.name).name,
      visibility: 'public',
      imageTags: ['1.0.0'],
      relativeContextPath: '',
      relativeDockerfilePath: getResources().packages.package1.relativeDockerFilePath,
      taskTimeoutMs: 10_000,
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

  expect(aborted.taskResult.notes).toEqual([
    `the generated url from your configuration (getCommitTarGzPublicAddress) is not reachable: "http://lalaala-invalid-url:8080". Did you forgot to push your commit?`,
  ])
})

test('reproduce bug: user provide tar gz to repository which is not exist - it can be because of unpushed commit or a typo or any other reason - ensure the task is not completed successfully', async () => {
  const [{ taskId }] = getResources().taskQueuesResources.queue.addTasksToQueue([
    {
      packageName: getResources().packages.package1.name,
      repoName: distructPackageJsonName(getResources().packages.package1.name).name,
      visibility: 'public',
      imageTags: ['1.0.0'],
      relativeContextPath: '',
      relativeDockerfilePath: getResources().packages.package1.relativeDockerFilePath,
      taskTimeoutMs: 10_000,
    },
  ])

  const events = await firstValueFrom(
    toTaskEvent$(taskId, {
      eventEmitter: getResources().taskQueuesResources.queue.eventEmitter,
      throwOnTaskNotPassed: false,
    }).pipe(toArray()),
  )

  expect(events[0].taskExecutionStatus).toEqual(ExecutionStatus.scheduled)
  expect(events.some(e => e.taskExecutionStatus === ExecutionStatus.aborted)).toBeTruthy()
  expect(events.some(e => e.taskExecutionStatus === ExecutionStatus.done)).toBeFalsy()
})
