export type WorkerConfig = {
  queueName: string
  waitBeforeExitMs: number
  redisServerUri: string
}

export type WorkerTask = {
  shellCommand: string
  cwd: string
}
