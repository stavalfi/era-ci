import { createTest, isDeepSubset } from '@era-ci/e2e-tests-infra'
import { amountOfWrokersKey, startWorker, WorkerConfig, WorkerTask } from '@era-ci/task-worker'
import { DoneResult, ExecutionStatus, Status } from '@era-ci/utils'
import Queue from 'bee-queue'
import chance from 'chance'
import { createFolder } from 'create-folder-structure'
import execa from 'execa'
import fs from 'fs'
import Redis from 'ioredis'
import _ from 'lodash'
import path from 'path'

const { getResources } = createTest()

const cleanups: (() => Promise<unknown>)[] = []

afterEach(async () => {
  await Promise.allSettled(cleanups.map(f => f()))
  cleanups.splice(0, cleanups.length)
})

async function createQueue(queueName: string): Promise<Queue<WorkerTask>> {
  const queue = new Queue<WorkerTask>(queueName, {
    redis: { host: getResources().redisServerHost, port: getResources().redisServerPort },
    removeOnSuccess: true,
    removeOnFailure: true,
  })

  await queue.ready()
  cleanups.push(() => queue.close())

  return queue
}

test('no tasks - manual close worker', async () => {
  const repoPath = await createFolder()
  const { cleanup } = await startWorker({
    queueName: `queue-${chance().hash().slice(0, 8)}`,
    repoPath,
    maxWaitMsWithoutTasks: 100_000,
    maxWaitMsUntilFirstTask: 100_000,
    redis: {
      url: getResources().redisServerUrl,
    },
  })

  await cleanup()
})

test('single worker - amount of workers === 1', async () => {
  const repoPath = await createFolder()

  const queueName = `queue-${chance().hash().slice(0, 8)}`

  const { cleanup } = await startWorker({
    queueName,
    repoPath,
    maxWaitMsWithoutTasks: 100_000,
    maxWaitMsUntilFirstTask: 100_000,
    redis: {
      url: getResources().redisServerUrl,
    },
  })

  const redisConnection = new Redis(getResources().redisServerUrl)
  cleanups.push(async () => redisConnection.disconnect())

  await expect(redisConnection.get(amountOfWrokersKey(queueName))).resolves.toEqual('1')

  await cleanup()

  await expect(redisConnection.get(amountOfWrokersKey(queueName))).resolves.toEqual('0')
})

test('manual close worker multiple times', async () => {
  const repoPath = await createFolder()
  const { cleanup } = await startWorker({
    queueName: `queue-${chance().hash().slice(0, 8)}`,
    repoPath,
    maxWaitMsWithoutTasks: 100_000,
    maxWaitMsUntilFirstTask: 100_000,
    redis: {
      url: getResources().redisServerUrl,
    },
  })

  await cleanup()
  await cleanup()
  await cleanup()
})

test('single task - success', async () => {
  const repoPath = await createFolder()
  const queueName = `queue-${chance().hash().slice(0, 8)}`
  const { cleanup } = await startWorker({
    queueName,
    repoPath,
    maxWaitMsWithoutTasks: 100_000,
    maxWaitMsUntilFirstTask: 100_000,
    redis: {
      url: getResources().redisServerUrl,
    },
  })
  cleanups.push(cleanup)

  const queue = await createQueue(queueName)
  const task1 = queue.createJob({
    shellCommand: 'echo hi > file1.txt',
    cwd: repoPath,
  })

  const result = await new Promise<DoneResult>(res => {
    task1.once('succeeded', res)
    task1.save()
  })

  expect(
    isDeepSubset(result, {
      executionStatus: ExecutionStatus.done,
      status: Status.passed,
      notes: [],
      errors: [],
      returnValue: undefined,
    }),
  ).toBeTruthy()

  const content = await fs.promises.readFile(path.join(repoPath, 'file1.txt'), 'utf-8')
  expect(content).toEqual('hi\n')
})

test('multiple tasks - all success', async () => {
  const repoPath = await createFolder()
  const queueName = `queue-${chance().hash().slice(0, 8)}`
  const { cleanup } = await startWorker({
    queueName,
    repoPath,
    maxWaitMsWithoutTasks: 100_000,
    maxWaitMsUntilFirstTask: 100_000,
    redis: {
      url: getResources().redisServerUrl,
    },
  })
  cleanups.push(cleanup)

  const queue = await createQueue(queueName)

  const results = await Promise.all(
    _.range(0, 3).map(i => {
      const task1 = queue.createJob({
        shellCommand: 'echo hi',
        cwd: repoPath,
      })

      return new Promise<DoneResult>(res => {
        task1.once('succeeded', res)
        task1.save()
      })
    }),
  )

  for (const result of results) {
    expect(
      isDeepSubset(result, {
        executionStatus: ExecutionStatus.done,
        status: Status.passed,
        notes: [],
        errors: [],
        returnValue: undefined,
      }),
    ).toBeTruthy()
  }
})

test('single empty task - expect to fail', async () => {
  const repoPath = await createFolder()
  const queueName = `queue-${chance().hash().slice(0, 8)}`
  const { cleanup } = await startWorker({
    queueName,
    repoPath,
    maxWaitMsWithoutTasks: 100_000,
    maxWaitMsUntilFirstTask: 100_000,
    redis: {
      url: getResources().redisServerUrl,
    },
  })
  cleanups.push(cleanup)

  const queue = await createQueue(queueName)
  const task1 = queue.createJob({
    shellCommand: '',
    cwd: repoPath,
  })

  const result = await new Promise<DoneResult>(res => {
    task1.once('succeeded', res)
    task1.save()
  })

  expect(
    isDeepSubset(result, {
      executionStatus: ExecutionStatus.done,
      status: Status.failed,
      notes: [],
      errors: [],
      returnValue: undefined,
    }),
  ).toBeTruthy()
})

test('single task - expect to fail', async () => {
  const repoPath = await createFolder()
  const queueName = `queue-${chance().hash().slice(0, 8)}`
  const { cleanup } = await startWorker({
    queueName,
    repoPath,
    maxWaitMsWithoutTasks: 100_000,
    maxWaitMsUntilFirstTask: 100_000,
    redis: {
      url: getResources().redisServerUrl,
    },
  })
  cleanups.push(cleanup)

  const queue = await createQueue(queueName)
  const task1 = queue.createJob({
    shellCommand: 'exit 1',
    cwd: repoPath,
  })

  const result = await new Promise<DoneResult>(res => {
    task1.once('succeeded', res)
    task1.save()
  })

  expect(
    isDeepSubset(result, {
      executionStatus: ExecutionStatus.done,
      status: Status.failed,
      notes: [],
      errors: [
        {
          exitCode: 1,
        },
      ],
      returnValue: undefined,
    }),
  ).toBeTruthy()
})

test('multiple tasks - all fail', async () => {
  const repoPath = await createFolder()
  const queueName = `queue-${chance().hash().slice(0, 8)}`
  const { cleanup } = await startWorker({
    queueName,
    repoPath,
    maxWaitMsWithoutTasks: 100_000,
    maxWaitMsUntilFirstTask: 100_000,
    redis: {
      url: getResources().redisServerUrl,
    },
  })
  cleanups.push(cleanup)

  const queue = await createQueue(queueName)

  const results = await Promise.all(
    _.range(0, 3).map(i => {
      const task1 = queue.createJob({
        shellCommand: 'exit 1',
        cwd: repoPath,
      })

      return new Promise<DoneResult>(res => {
        task1.once('succeeded', res)
        task1.save()
      })
    }),
  )

  for (const result of results) {
    expect(
      isDeepSubset(result, {
        executionStatus: ExecutionStatus.done,
        status: Status.failed,
        notes: [],
        errors: [
          {
            exitCode: 1,
          },
        ],
        returnValue: undefined,
      }),
    ).toBeTruthy()
  }
})

test('no tasks so the worker is closing automaticaly', async () => {
  const repoPath = await createFolder()

  const workerConfig: WorkerConfig = {
    queueName: `queue-${chance().hash().slice(0, 8)}`,
    maxWaitMsWithoutTasks: 100_000,
    maxWaitMsUntilFirstTask: 1_000,
    redis: {
      url: getResources().redisServerUrl,
    },
  }

  await fs.promises.writeFile(
    path.join(repoPath, 'task-worker.config.ts'),
    `export default ${JSON.stringify(workerConfig, null, 2)}`,
    'utf-8',
  )

  const { stdout } = await execa.command(
    `${require.resolve('.bin/swc-node')} ${require.resolve('@era-ci/task-worker')} --repo-path ${repoPath}`,
    {
      stdio: 'pipe',
    },
  )

  expect(stdout).toEqual(expect.stringContaining('no tasks at all - shuting down worker'))
})

test('single task -> no tasks so the worker is closing automaticaly', async () => {
  const repoPath = await createFolder()

  const queueName = `queue-${chance().hash().slice(0, 8)}`

  const workerConfig: WorkerConfig = {
    queueName,
    maxWaitMsWithoutTasks: 3_000,
    maxWaitMsUntilFirstTask: 100_000,
    redis: {
      url: getResources().redisServerUrl,
    },
  }

  const queue = await createQueue(queueName)
  const task1 = queue.createJob({
    shellCommand: 'echo hi',
    cwd: repoPath,
  })

  await fs.promises.writeFile(
    path.join(repoPath, 'task-worker.config.ts'),
    `export default ${JSON.stringify(workerConfig, null, 2)}`,
    'utf-8',
  )

  const workerProcess = execa.command(
    `${require.resolve('.bin/swc-node')} ${require.resolve('@era-ci/task-worker')} --repo-path ${repoPath}`,
    {
      stdio: 'pipe',
    },
  )

  await new Promise<DoneResult>(res => {
    task1.once('succeeded', res)
    task1.save()
  })

  const { stdout } = await workerProcess

  expect(stdout).toEqual(expect.stringContaining('no more tasks - shuting down worker'))
})
