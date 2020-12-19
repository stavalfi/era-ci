import { toTaskEvent$ } from '@tahini/core'
import { QuayBuildsTaskQueue } from '@tahini/task-queues'
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
  ).toPromise()

  for (const [i, packageInfo] of Object.values(getResources().packages).entries()) {
    await expect(getImageTags(packageInfo.name)).resolves.toEqual([`1.0.${i}`])
  }
})
