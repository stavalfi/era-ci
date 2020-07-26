/* eslint-disable no-console */
import { Queue, Worker } from 'bullmq'
import IORedis from 'ioredis'
import chance from 'chance'
import { setTimeout } from 'timers'

async function subscribe(connection: IORedis.Redis, queueName: string, workerId: string) {
  const worker = new Worker(
    queueName,
    async job => {
      console.log(workerId, 'start', job.data)
      await new Promise(res => setTimeout(res, 100))
      console.log(workerId, 'end', job.data)
    },
    { connection: connection, concurrency: 30_000 },
  )
  await worker.waitUntilReady()
}

async function main() {
  const pendingQueueName = `queue-pending`
  const connection: IORedis.Redis = new IORedis({ host: 'localhost', port: 6379 })
  const pendingQueue = new Queue(pendingQueueName, { connection })

  for (let i = 0; i < 5; i++) {
    await subscribe(connection, pendingQueueName, `worker-${i}`)
  }

  for (let i = 0; i < 100; i++) {
    await pendingQueue.add('lala', chance().hash())
  }
}

// eslint-disable-next-line no-floating-promise/no-floating-promise
main()
