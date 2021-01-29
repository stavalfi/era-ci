import { Logger } from '@era-ci/core'
import Redis from 'ioredis'

export type WorkerConfig = {
  queueName: string
  maxWaitMsWithoutTasks: number
  maxWaitMsUntilFirstTask: number
  redis: {
    url: string
    auth?: {
      // username is not supported in bee-queue because bee-queue uses redis and it doesn't support redis-acl:
      // https://github.com/NodeRedis/node-redis/issues/1451
      // in next-major version of bee-queue, they will move to ioredis so then we can use "username".
      password?: string
    }
  }
}

export type WorkerTask = {
  task: {
    shellCommand: string
    cwd: string
    processEnv?: NodeJS.ProcessEnv
  }
  group?:
    | {
        groupId: string
        beforeAll: {
          shellCommand: string
          cwd: string
          processEnv?: NodeJS.ProcessEnv
        }
      }
    | false
}

export type TaskWorker = {
  logFilePath: string
  cleanup: () => Promise<void>
}

export type StartWorkerOptions = {
  config: WorkerConfig
  processEnv: NodeJS.ProcessEnv
  logger: Logger
  workerName?: string
  redisConnection: Redis.Redis
  onFinish?: () => Promise<void>
  connectionsCleanups?: (() => Promise<unknown>)[]
}

export type WorkerState = {
  receivedFirstTask: boolean
  isRunningTaskNow: boolean
  allTasksSucceed: boolean
  lastTaskEndedMs: number
  terminatingWorker: boolean
}
