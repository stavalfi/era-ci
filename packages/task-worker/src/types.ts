export type WorkerConfig = {
  queueName: string
  waitBeforeExitMs: number
  redis: {
    host: string
    port: number
  }
}

export type WorkerTask = {
  shellCommand: string
  cwd: string
}
