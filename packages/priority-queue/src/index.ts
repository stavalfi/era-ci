/* eslint-disable no-process-env */
/* eslint-disable no-console */
import { Queue, Worker, Job } from 'bullmq'
import IORedis from 'ioredis'
import chance from 'chance'

async function processBetSlip(job: Job) {
  console.log('start in-progress job: ', process.env.NAME, job.data)
  await new Promise(res => setTimeout(res, 1000))
  job.updateProgress({})
  console.log('end in-progress job: ', process.env.NAME, job.data)
}

async function main() {
  const betslipEndedTopic = 'bet-slip-end-topic'
  const betslipEndedConnection: IORedis.Redis = new IORedis({ host: 'localhost', port: 6379 })
  await betslipEndedConnection.subscribe(betslipEndedTopic)

  const inProgressQueueName = `queue-in-progress`
  const pendingQueueName = `queue-pending`
  const redisConnection: IORedis.Redis = new IORedis({ host: 'localhost', port: 6379 })
  redisConnection.defineCommand('incIfLessOrThrow', {
    numberOfKeys: 1,
    lua: `
local max_open_betlips_concurrently = tonumber(ARGV[1]);
local account_id = KEYS[1];

local open_betslips_now = tonumber(redis.call('GET', account_id));

if open_betslips_now == nil or open_betslips_now < max_open_betlips_concurrently then 
  redis.call('INCR', account_id);
else
  error("account is full");
end
`,
  })
  await redisConnection['incIfLessOrThrow'](mollyAccount, MAX_BETSLIPS)

  const mollyAccount = 'stavalfi2'
  console.log(await redisConnection.get(mollyAccount))
  // @ts-ignore
  await redisConnection['incIfLessOrThrow'](mollyAccount, 1)
  console.log(await redisConnection.get(mollyAccount))

  return

  // const inProgressQueue = new Queue(inProgressQueueName, { connection: redisConnection })

  // new Worker(
  //   inProgressQueueName,
  //   async job => {
  //     try {
  //       await processBetSlip(job)
  //     } finally {
  //       await redisConnection.decr(job.data.account)
  //       await redisConnection.publish(betslipEndedTopic, job.data.account)
  //     }
  //   },
  //   { connection: redisConnection, concurrency: 30_000 },
  // )

  // new Worker(
  //   pendingQueueName,
  //   async function handleJob(job) {
  //     console.log('new pending job: ', process.env.NAME, job.data)
  //     const someBetslipEndedPromise = new Promise(res => betslipEndedConnection.once('message', res))
  //     const mollyAccount = 'stavalfi1'
  //     // @ts-ignore
  //     await redisConnection['incIfLessOrThrow'](mollyAccount, 8)
  //     // await connection.multi({ pipeline: false })
  //     // const statusesAsStrings = await Promise.all(mollyAccounts.map(account => connection.get(account)))
  //     // const statuses = statusesAsStrings.map(status => Number(status))
  //     console.log({ mollyAccounts })
  //     // console.log({ statusesAsStrings })
  //     // console.log({ statuses })
  //     // const freeAccountIndex = statuses.findIndex(status => status < 8)
  //     const freeAccountIndex = chance().integer({ min: 0, max: mollyAccounts.length - 1 })
  //     console.log({ freeAccountIndex })
  //     if (freeAccountIndex > -1) {
  //       // await connection.set(mollyAccounts[freeAccountIndex], statuses[freeAccountIndex] + 1)
  //       // await connection.exec()
  //       return inProgressQueue.add(job.name, job.data)
  //     } else {
  //       // await connection.exec()
  //       if (freeAccountIndex === -1) {
  //         await someBetslipEndedPromise
  //         await handleJob(job)
  //       }
  //     }
  //   },
  //   { connection: redisConnection, concurrency: 1 },
  // )
}

// eslint-disable-next-line no-floating-promise/no-floating-promise
main()
