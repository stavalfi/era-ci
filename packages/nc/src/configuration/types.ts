import { CreateKeyValueStoreConnection } from '../create-key-value-store-connection'
import { CreateLogger } from '../create-logger'
import { Step, StepInfo } from '../create-step'
import { Graph } from '../types'

export type Config<CreateTaskQueueArray extends Array<{ taskQueueName: string }>> = {
  keyValueStore: CreateKeyValueStoreConnection
  logger: CreateLogger
  taskQueues: CreateTaskQueueArray
  steps: Graph<{
    stepInfo: StepInfo
    taskQueueName: CreateTaskQueueArray[number]['taskQueueName']
    runStep: Step<CreateTaskQueueArray[number]['taskQueueName']>['runStep']
  }>
}
