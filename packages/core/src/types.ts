import { Actions } from './steps-execution'

export type RedisFlowEvent = {
  flowId: string
  gitCommit: string
  repoName: string
  repoHash: string
  startFlowMs: number
  eventTs: number
  event: Actions
}
