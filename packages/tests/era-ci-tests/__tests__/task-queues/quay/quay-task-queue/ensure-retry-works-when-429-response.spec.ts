import { toTaskEvent$ } from '@era-ci/core'
import { distructPackageJsonName, lastValueFrom } from '@era-ci/utils'
import { merge } from 'rxjs'
import { beforeAfterEach, test } from '../utils'
import expect from 'expect'

beforeAfterEach(test, {
  quayMockService: {
    rateLimit: {
      max: 14,
      timeWindowMs: 1000,
    },
  },
})

test('ensure-retry-works-when-429-response.spec - multiple tasks', async t => {
  const tasks = t.context.taskQueuesResources.queue.addTasksToQueue(
    Object.values(t.context.packages).map((packageInfo, i) => ({
      packageName: packageInfo.name,
      repoName: distructPackageJsonName(packageInfo.name).name,
      visibility: 'public',
      imageTags: [`1.0.${i}`],
      relativeContextPath: '/',
      relativeDockerfilePath: packageInfo.relativeDockerFilePath,
      taskTimeoutMs: 1000000,
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
  ).catch(error => {
    t.log(
      'manually printing error because the error-properties are not shown by test-runner: ',
      JSON.stringify(error, null, 2),
    )
    throw error
  })

  for (const [i, packageInfo] of Object.values(t.context.packages).entries()) {
    await expect(t.context.getImageTags(packageInfo.name)).resolves.toEqual([`1.0.${i}`])
  }
})
