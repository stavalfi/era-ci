import { toTaskEvent$ } from '@era-ci/core'
import { QuayBuildsTaskQueue } from '@era-ci/task-queues'
import { merge } from 'rxjs'
import { beforeAfterEach } from '../utils'

const { getResources, getImageTags } = beforeAfterEach({
  quayMockService: {
    rateLimit: {
      max: 14,
      timeWindowMs: 1000,
    },
  },
})

let taskQueue: QuayBuildsTaskQueue

beforeEach(() => {
  taskQueue = getResources().queue
})

test('multiple tasks', async () => {
  const tasks = taskQueue.addTasksToQueue(
    Object.values(getResources().packages).map((packageInfo, i) => ({
      packageName: packageInfo.name,
      repoName: packageInfo.name,
      visibility: 'public',
      imageTags: [`1.0.${i}`],
      relativeContextPath: '/',
      relativeDockerfilePath: packageInfo.relativeDockerFilePath,
      taskTimeoutMs: 1000000,
    })),
  )

  await merge(
    ...tasks.map(task =>
      toTaskEvent$(task.taskId, { eventEmitter: taskQueue.eventEmitter, throwOnTaskNotPassed: true }),
    ),
  )
    .toPromise()
    .catch(error => {
      // eslint-disable-next-line no-console
      console.log(
        'manually printing error because the error-properties are not shown by jest: ',
        JSON.stringify(error, null, 2),
      )
      throw error
    })

  for (const [i, packageInfo] of Object.values(getResources().packages).entries()) {
    await expect(getImageTags(packageInfo.name)).resolves.toEqual([`1.0.${i}`])
  }
})
