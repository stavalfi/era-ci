import { toTaskEvent$ } from '@tahini/nc'
import { QuayBuildsTaskQueue } from '@tahini/quay-task-queue'
import { merge } from 'rxjs'
import { beforeAfterEach } from '../utils'

const { getResoureces, getImageTags } = beforeAfterEach({
  quayMockService: {
    rateLimit: {
      max: 14,
      timeWindowMs: 1000,
    },
  },
})

let taskQueue: QuayBuildsTaskQueue

beforeEach(() => {
  taskQueue = getResoureces().queue
})

test('multiple tasks', async () => {
  const tasks = taskQueue.addTasksToQueue(
    Object.values(getResoureces().packages).map((packageInfo, i) => ({
      packageName: packageInfo.name,
      imageTags: [`1.0.${i}`],
      relativeContextPath: '/',
      relativeDockerfilePath: packageInfo.relativeDockerFilePath,
    })),
  )

  await merge(
    ...tasks.map(task =>
      toTaskEvent$(task.taskId, { eventEmitter: taskQueue.eventEmitter, errorOnTaskNotPassed: true }),
    ),
  ).toPromise()

  for (const [i, packageInfo] of Object.values(getResoureces().packages).entries()) {
    await expect(getImageTags(packageInfo.name)).resolves.toEqual([`1.0.${i}`])
  }
})
