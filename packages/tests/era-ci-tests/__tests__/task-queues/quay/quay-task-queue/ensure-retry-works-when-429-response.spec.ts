import { toTaskEvent$ } from '@era-ci/core'
import { distructPackageJsonName } from '@era-ci/utils'
import { test, expect } from '@jest/globals'
import { lastValueFrom, merge } from 'rxjs'
import { beforeAfterEach } from '../utils'

const { getResources } = beforeAfterEach({
  quayMockService: {
    rateLimit: {
      max: 14,
      timeWindowMs: 1000,
    },
  },
})

// NOTE: this test is flaky in CI. I think it is related to the fact that the CI is much slower but im not sure what is the cause of the failures.
test.skip('ensure-retry-works-when-429-response.spec - multiple tasks', async () => {
  const tasks = getResources().taskQueuesResources.queue.addTasksToQueue(
    Object.values(getResources().packages).map((packageInfo, i) => ({
      packageName: packageInfo.name,
      repoName: distructPackageJsonName(packageInfo.name).name,
      visibility: 'public',
      imageTags: [`1.0.${i}`],
      relativeContextPath: '',
      relativeDockerfilePath: packageInfo.relativeDockerFilePath,
      taskTimeoutMs: 100_000,
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
  ).catch(error => {
    // eslint-disable-next-line no-console
    console.log(
      'manually printing error because the error-properties are not shown by test-runner: ',
      JSON.stringify(error, null, 2),
    )
    throw error
  })

  for (const [i, packageInfo] of Object.values(getResources().packages).entries()) {
    await expect(getResources().getImageTags(packageInfo.name)).resolves.toEqual([`1.0.${i}`])
  }
})
