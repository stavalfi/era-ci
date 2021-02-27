import { Graph, StepInfo } from '@era-ci/utils'
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

export type CiResult = {
  flowId: string
  repoHash?: string
  steps?: Graph<{ stepInfo: StepInfo }>
  passed: boolean
  fatalError: boolean
}
