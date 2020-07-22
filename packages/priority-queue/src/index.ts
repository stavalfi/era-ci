/* eslint-disable no-console */
import { Queue, Worker } from 'bullmq'
import IORedis from 'ioredis'

async function main() {
  const queueName = 'noy11'
  const connection: IORedis.Redis = new IORedis({ host: 'localhost', port: 6379 })
  const betSlipQueue = new Queue(queueName, { connection })

  new Worker(
    queueName,
    async job => {
      console.log('new event', job.data)
    },
    { connection },
  )

  await betSlipQueue.add('lala', 1, {
    jobId: '200',
  })
}

// eslint-disable-next-line no-floating-promise/no-floating-promise
main()
