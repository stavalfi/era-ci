import { createTest, isDeepSubset } from '@tahini/e2e-tests-infra'
import { amountOfWrokersKey, startWorker, WorkerConfig, WorkerTask } from '@tahini/task-worker'
import { DoneResult, ExecutionStatus, Status } from '@tahini/utils'
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
    waitBeforeExitMs: 100_000,
    redisServerUri: getResources().redisServerUri,
  })

  await cleanup()
})

test('single worker - amount of workers === 1', async () => {
  const repoPath = await createFolder()

  const queueName = `queue-${chance().hash().slice(0, 8)}`

  const { cleanup } = await startWorker({
    queueName,
    repoPath,
    waitBeforeExitMs: 100_000,
    redisServerUri: getResources().redisServerUri,
  })

  const redisConnection = new Redis({ host: getResources().redisServerHost, port: getResources().redisServerPort })
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
    waitBeforeExitMs: 100_000,
    redisServerUri: getResources().redisServerUri,
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
    waitBeforeExitMs: 100_000,
    redisServerUri: getResources().redisServerUri,
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
    waitBeforeExitMs: 100_000,
    redisServerUri: getResources().redisServerUri,
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
    waitBeforeExitMs: 100_000,
    redisServerUri: getResources().redisServerUri,
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
    waitBeforeExitMs: 100_000,
    redisServerUri: getResources().redisServerUri,
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
    waitBeforeExitMs: 100_000,
    redisServerUri: getResources().redisServerUri,
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
    waitBeforeExitMs: 1_000,
    redisServerUri: getResources().redisServerUri,
  }

  await fs.promises.writeFile(
    path.join(repoPath, 'task-worker.config.ts'),
    `export default ${JSON.stringify(workerConfig, null, 2)}`,
    'utf-8',
  )

  const { stdout } = await execa.command(
    `${require.resolve('.bin/swc-node')} ${require.resolve('@tahini/task-worker')} --repo-path ${repoPath}`,
    {
      stdio: 'pipe',
    },
  )

  expect(stdout).toEqual(expect.stringContaining('no more tasks - shuting down worker'))
})

test('single task -> no tasks so the worker is closing automaticaly', async () => {
  const repoPath = await createFolder()

  const queueName = `queue-${chance().hash().slice(0, 8)}`

  const workerConfig: WorkerConfig = {
    queueName,
    waitBeforeExitMs: 3_000,
    redisServerUri: getResources().redisServerUri,
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
    `${require.resolve('.bin/swc-node')} ${require.resolve('@tahini/task-worker')} --repo-path ${repoPath}`,
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
