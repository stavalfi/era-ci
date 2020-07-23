/* eslint-disable no-console */
import { Queue } from 'bullmq'
import IORedis from 'ioredis'
import chance from 'chance'

async function main() {
  const pendingQueueName = `queue-pending`
  const connection: IORedis.Redis = new IORedis({ host: 'localhost', port: 6379 })
  const pendingQueue = new Queue(pendingQueueName, { connection })

  for (let i = 0; i < 1; i++) {
    await pendingQueue.add('lala', chance().hash())
  }
}

// eslint-disable-next-line no-floating-promise/no-floating-promise
main()
