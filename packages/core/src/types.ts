import { Actions } from './steps-execution'

export type StepRedisEvent = {
  flowId: string
  gitCommit: string
  repoName: string
  repoHash: string
  startFlowMs: number
  event: Actions
  eventTs: number
}
