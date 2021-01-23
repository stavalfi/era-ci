/* eslint-disable no-console */
import { createTest, isDeepSubset } from '@era-ci/e2e-tests-infra'
import { amountOfWrokersKey, startWorker, WorkerConfig, WorkerTask } from '@era-ci/task-worker'
import { DoneResult, ExecutionStatus, Status } from '@era-ci/utils'
import Queue from 'bee-queue'
import chance from 'chance'
import { createFolder } from 'create-folder-structure'
import execa from 'execa'
import expect from 'expect'
import fs from 'fs'
import Redis from 'ioredis'
import _ from 'lodash'
import path from 'path'

const { getCleanups, getProcessEnv, getResources, createTestLogger } = createTest()

async function createQueue(queueName: string): Promise<Queue<WorkerTask>> {
  const queue = new Queue<WorkerTask>(queueName, {
    redis: { host: getResources().redisServerHost, port: getResources().redisServerPort },
    removeOnSuccess: true,
    removeOnFailure: true,
  })

  await queue.ready()
  getCleanups().push(() => queue.close())

  return queue
}

test('no tasks - manual close worker', async () => {
  const repoPath = await createFolder()
  const { cleanup } = await startWorker({
    config: {
      queueName: `queue-${chance().hash().slice(0, 8)}`,
      repoPath,
      maxWaitMsWithoutTasks: 10_000,
      maxWaitMsUntilFirstTask: 10_000,
      redis: {
        url: getResources().redisServerUrl,
      },
    },
    processEnv: getProcessEnv(),
    logger: await createTestLogger(repoPath),
  })

  await cleanup()
})

test('single worker - amount of workers === 1', async () => {
  const repoPath = await createFolder()

  const queueName = `queue-${chance().hash().slice(0, 8)}`

  const { cleanup } = await startWorker({
    config: {
      queueName,
      repoPath,
      maxWaitMsWithoutTasks: 10_000,
      maxWaitMsUntilFirstTask: 10_000,
      redis: {
        url: getResources().redisServerUrl,
      },
    },
    processEnv: getProcessEnv(),
    logger: await createTestLogger(repoPath),
  })

  const redisConnection = new Redis(getResources().redisServerUrl)
  getCleanups().push(async () => redisConnection.disconnect())

  await expect(redisConnection.get(amountOfWrokersKey(queueName))).resolves.toEqual('1')

  await cleanup()

  await expect(redisConnection.get(amountOfWrokersKey(queueName))).resolves.toEqual('0')
})

test('manual close worker multiple times', async () => {
  const repoPath = await createFolder()
  const { cleanup } = await startWorker({
    config: {
      queueName: `queue-${chance().hash().slice(0, 8)}`,
      repoPath,
      maxWaitMsWithoutTasks: 10_000,
      maxWaitMsUntilFirstTask: 10_000,
      redis: {
        url: getResources().redisServerUrl,
      },
    },
    processEnv: getProcessEnv(),
    logger: await createTestLogger(repoPath),
  })

  await cleanup()
  await cleanup()
  await cleanup()
})

test('single task - success', async () => {
  const repoPath = await createFolder()
  const queueName = `queue-${chance().hash().slice(0, 8)}`
  const { cleanup } = await startWorker({
    config: {
      queueName,
      repoPath,
      maxWaitMsWithoutTasks: 10_000,
      maxWaitMsUntilFirstTask: 10_000,
      redis: {
        url: getResources().redisServerUrl,
      },
    },
    processEnv: getProcessEnv(),
    logger: await createTestLogger(repoPath),
  })
  getCleanups().push(cleanup)

  const queue = await createQueue(queueName)
  const task1 = queue.createJob({
    task: {
      shellCommand: 'echo hi > file1.txt',
      cwd: repoPath,
    },
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
    config: {
      queueName,
      repoPath,
      maxWaitMsWithoutTasks: 10_000,
      maxWaitMsUntilFirstTask: 10_000,
      redis: {
        url: getResources().redisServerUrl,
      },
    },
    processEnv: getProcessEnv(),
    logger: await createTestLogger(repoPath),
  })
  getCleanups().push(cleanup)

  const queue = await createQueue(queueName)

  const results = await Promise.all(
    _.range(0, 3).map(i => {
      const task1 = queue.createJob({
        task: { shellCommand: 'echo hi', cwd: repoPath },
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
    config: {
      queueName,
      repoPath,
      maxWaitMsWithoutTasks: 10_000,
      maxWaitMsUntilFirstTask: 10_000,
      redis: {
        url: getResources().redisServerUrl,
      },
    },
    processEnv: getProcessEnv(),
    logger: await createTestLogger(repoPath),
  })
  getCleanups().push(cleanup)

  const queue = await createQueue(queueName)
  const task1 = queue.createJob({
    task: { shellCommand: '', cwd: repoPath },
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
    config: {
      queueName,
      repoPath,
      maxWaitMsWithoutTasks: 10_000,
      maxWaitMsUntilFirstTask: 10_000,
      redis: {
        url: getResources().redisServerUrl,
      },
    },
    processEnv: getProcessEnv(),
    logger: await createTestLogger(repoPath),
  })
  getCleanups().push(cleanup)

  const queue = await createQueue(queueName)
  const task1 = queue.createJob({
    task: { shellCommand: 'exit 1', cwd: repoPath },
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
    config: {
      queueName,
      repoPath,
      maxWaitMsWithoutTasks: 10_000,
      maxWaitMsUntilFirstTask: 10_000,
      redis: {
        url: getResources().redisServerUrl,
      },
    },
    processEnv: getProcessEnv(),
    logger: await createTestLogger(repoPath),
  })
  getCleanups().push(cleanup)

  const queue = await createQueue(queueName)

  const results = await Promise.all(
    _.range(0, 3).map(i => {
      const task1 = queue.createJob({
        task: { shellCommand: 'exit 1', cwd: repoPath },
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

test('the worker runs a task which fails so when the worker exits, it will exit with exit-code !== 0', async () => {
  const repoPath = await createFolder()

  const queueName = `queue-${chance().hash().slice(0, 8)}`

  const workerConfig: WorkerConfig = {
    queueName,
    maxWaitMsWithoutTasks: 3_000,
    maxWaitMsUntilFirstTask: 10_000,
    redis: {
      url: getResources().redisServerUrl,
    },
  }

  const queue = await createQueue(queueName)
  const task1 = queue.createJob({
    task: { shellCommand: 'exit 1', cwd: repoPath },
  })

  await fs.promises.writeFile(
    path.join(repoPath, 'task-worker.config.ts'),
    `export default ${JSON.stringify(workerConfig, null, 2)}`,
    'utf-8',
  )
  const workerProcess = execa.command(
    `yarn node -r ts-node/register --trace-warnings --unhandled-rejections=strict ${require.resolve(
      '@era-ci/task-worker',
    )} --repo-path ${repoPath}`,
    {
      stdio: 'pipe',
      cwd: __dirname, // helping yarn to find "ts-node/register",
      reject: false,
    },
  )

  await new Promise<DoneResult>(res => {
    task1.once('succeeded', res)
    task1.save()
  })

  const { exitCode } = await workerProcess

  expect(exitCode).not.toEqual(0)
})

test('the worker runs multiple tasks which one of them fail. so when the worker exits, it will exit with exit-code !== 0', async () => {
  const repoPath = await createFolder()

  const queueName = `queue-${chance().hash().slice(0, 8)}`

  const workerConfig: WorkerConfig = {
    queueName,
    maxWaitMsWithoutTasks: 3_000,
    maxWaitMsUntilFirstTask: 10_000,
    redis: {
      url: getResources().redisServerUrl,
    },
  }

  const queue = await createQueue(queueName)
  const task1 = queue.createJob({
    task: { shellCommand: 'exit 1', cwd: repoPath },
  })
  const task2 = queue.createJob({
    task: { shellCommand: 'echo hi', cwd: repoPath },
  })
  const task3 = queue.createJob({
    task: { shellCommand: 'echo hi', cwd: repoPath },
  })

  await fs.promises.writeFile(
    path.join(repoPath, 'task-worker.config.ts'),
    `export default ${JSON.stringify(workerConfig, null, 2)}`,
    'utf-8',
  )

  const workerProcess = execa.command(
    `yarn node -r ts-node/register --trace-warnings --unhandled-rejections=strict ${require.resolve(
      '@era-ci/task-worker',
    )} --repo-path ${repoPath}`,
    {
      stdio: 'pipe',
      cwd: __dirname,
      reject: false,
    },
  )

  await new Promise<DoneResult>(res => {
    task1.once('succeeded', res)
    task1.save()
  })
  await new Promise<DoneResult>(res => {
    task2.once('succeeded', res)
    task2.save()
  })
  await new Promise<DoneResult>(res => {
    task3.once('succeeded', res)
    task3.save()
  })

  const { exitCode } = await workerProcess

  expect(exitCode).not.toEqual(0)
})

test.only('no tasks so the worker is closing automaticaly', async () => {
  const repoPath = await createFolder()

  const workerConfig: WorkerConfig = {
    queueName: `queue-${chance().hash().slice(0, 8)}`,
    maxWaitMsUntilFirstTask: 1_000,
    maxWaitMsWithoutTasks: 10_000,
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
    `yarn node -r ts-node/register --trace-warnings --unhandled-rejections=strict ${require.resolve(
      '@era-ci/task-worker',
    )} --repo-path ${repoPath}`,
    {
      stdio: 'pipe',
      cwd: __dirname,
      reject: false,
    },
  )

  expect(stdout).toEqual(expect.stringContaining('no tasks at all - shutting down worker'))
})

test('single task -> after that, no tasks so the worker is closing automaticaly', async () => {
  const repoPath = await createFolder()

  const queueName = `queue-${chance().hash().slice(0, 8)}`

  const workerConfig: WorkerConfig = {
    queueName,
    maxWaitMsWithoutTasks: 3_000,
    maxWaitMsUntilFirstTask: 10_000,
    redis: {
      url: getResources().redisServerUrl,
    },
  }

  const queue = await createQueue(queueName)
  const task1 = queue.createJob({
    task: { shellCommand: 'echo hi', cwd: repoPath },
  })

  await fs.promises.writeFile(
    path.join(repoPath, 'task-worker.config.ts'),
    `export default ${JSON.stringify(workerConfig, null, 2)}`,
    'utf-8',
  )

  const workerProcess = execa.command(
    `yarn node -r ts-node/register --trace-warnings --unhandled-rejections=strict ${require.resolve(
      '@era-ci/task-worker',
    )} --repo-path ${repoPath}`,
    {
      stdio: 'pipe',
      cwd: __dirname,
    },
  )

  await new Promise<DoneResult>(res => {
    task1.once('succeeded', res)
    task1.save()
  })

  const { stdout } = await workerProcess

  expect(stdout).toEqual(expect.stringContaining('no more tasks - shutting down worker'))
})

test('single task - success - override processEnv', async () => {
  const repoPath = await createFolder()
  const queueName = `queue-${chance().hash().slice(0, 8)}`
  const { cleanup } = await startWorker({
    config: {
      queueName,
      repoPath,
      maxWaitMsWithoutTasks: 10_000,
      maxWaitMsUntilFirstTask: 10_000,
      redis: {
        url: getResources().redisServerUrl,
      },
    },
    processEnv: getProcessEnv(),
    logger: await createTestLogger(repoPath),
  })
  getCleanups().push(cleanup)

  const queue = await createQueue(queueName)
  const task1 = queue.createJob({
    task: {
      shellCommand: 'echo $X > file1.txt',
      cwd: repoPath,
      processEnv: {
        X: 'hi',
      },
    },
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

test('single task - success - part of a group', async () => {
  const repoPath = await createFolder()
  const queueName = `queue-${chance().hash().slice(0, 8)}`
  const { cleanup } = await startWorker({
    config: {
      queueName,
      repoPath,
      maxWaitMsWithoutTasks: 10_000,
      maxWaitMsUntilFirstTask: 10_000,
      redis: {
        url: getResources().redisServerUrl,
      },
    },
    processEnv: getProcessEnv(),
    logger: await createTestLogger(repoPath),
  })
  getCleanups().push(cleanup)

  const queue = await createQueue(queueName)
  const task1 = queue.createJob({
    group: {
      groupId: '1',
      beforeAll: {
        shellCommand: 'echo hi1 > file1.txt',
        cwd: repoPath,
      },
    },
    task: {
      shellCommand: 'echo hi2 > file2.txt',
      cwd: repoPath,
    },
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

  const content1 = await fs.promises.readFile(path.join(repoPath, 'file1.txt'), 'utf-8')
  expect(content1).toEqual('hi1\n')

  const content2 = await fs.promises.readFile(path.join(repoPath, 'file2.txt'), 'utf-8')
  expect(content2).toEqual('hi2\n')
})

test('single task - success - part of a group - override process-env', async () => {
  const repoPath = await createFolder()
  const queueName = `queue-${chance().hash().slice(0, 8)}`
  const { cleanup } = await startWorker({
    config: {
      queueName,
      repoPath,
      maxWaitMsWithoutTasks: 10_000,
      maxWaitMsUntilFirstTask: 10_000,
      redis: {
        url: getResources().redisServerUrl,
      },
    },
    processEnv: getProcessEnv(),
    logger: await createTestLogger(repoPath),
  })
  getCleanups().push(cleanup)

  const queue = await createQueue(queueName)
  const task1 = queue.createJob({
    group: {
      groupId: '1',
      beforeAll: {
        shellCommand: 'echo $X > file1.txt',
        cwd: repoPath,
        processEnv: {
          X: 'hi1',
        },
      },
    },
    task: {
      shellCommand: 'echo hi2 > file2.txt',
      cwd: repoPath,
    },
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

  const content1 = await fs.promises.readFile(path.join(repoPath, 'file1.txt'), 'utf-8')
  expect(content1).toEqual('hi1\n')

  const content2 = await fs.promises.readFile(path.join(repoPath, 'file2.txt'), 'utf-8')
  expect(content2).toEqual('hi2\n')
})

test('multiple tasks - before-all is called once', async () => {
  const repoPath = await createFolder()
  const queueName = `queue-${chance().hash().slice(0, 8)}`
  const { cleanup } = await startWorker({
    config: {
      queueName,
      repoPath,
      maxWaitMsWithoutTasks: 10_000,
      maxWaitMsUntilFirstTask: 10_000,
      redis: {
        url: getResources().redisServerUrl,
      },
    },
    processEnv: getProcessEnv(),
    logger: await createTestLogger(repoPath),
  })
  getCleanups().push(cleanup)

  const queue = await createQueue(queueName)
  const task1 = queue.createJob({
    group: {
      groupId: '1',
      beforeAll: {
        shellCommand: 'echo hi1 >> file1.txt',
        cwd: repoPath,
      },
    },
    task: {
      shellCommand: 'echo hi2 > file2.txt',
      cwd: repoPath,
    },
  })

  await new Promise<DoneResult>(res => {
    task1.once('succeeded', res)
    task1.save()
  })

  const task2 = queue.createJob({
    group: {
      groupId: '1',
      beforeAll: {
        shellCommand: 'echo hi1 >> file1.txt',
        cwd: repoPath,
      },
    },
    task: {
      shellCommand: 'echo hi3 > file2.txt',
      cwd: repoPath,
    },
  })

  await new Promise<DoneResult>(res => {
    task2.once('succeeded', res)
    task2.save()
  })

  const content1 = await fs.promises.readFile(path.join(repoPath, 'file1.txt'), 'utf-8')
  expect(content1).toEqual('hi1\n')
})
