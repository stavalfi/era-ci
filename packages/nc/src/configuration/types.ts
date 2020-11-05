import { CreateKeyValueStoreConnection } from '../create-key-value-store-connection'
import { CreateLogger } from '../create-logger'
import { Step, StepInfo } from '../create-step'
import { Graph } from '../types'

export type Config = {
  keyValueStore: CreateKeyValueStoreConnection
  logger: CreateLogger
  steps: Graph<{ stepInfo: StepInfo; runStep: Step['runStep'] }>
}
