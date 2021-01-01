export type WorkerConfig = {
  queueName: string
  waitBeforeExitMs: number
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
  shellCommand: string
  cwd: string
}
