import { CreateCache } from '../create-cache'
import { CreateLogger } from '../create-logger'
import { Step, StepInfo } from '../create-step'
import { Graph } from '../types'

export type Config = {
  cache: CreateCache
  logger: CreateLogger
  steps: Graph<{ stepInfo: StepInfo; runStep: Step['runStep'] }>
}
