import { CreateKeyValueStoreConnection } from '../create-key-value-store-connection'
import { CreateLogger } from '../create-logger'
import { Step, StepInfo } from '../create-step'
import { Graph } from '../types'

export type Config<TaskQueueArray extends Array<{ taskQueueName: string }>> = {
  keyValueStore: CreateKeyValueStoreConnection
  logger: CreateLogger
  taskQueues: TaskQueueArray
  steps: Graph<{
    stepInfo: StepInfo
    taskQueueName: TaskQueueArray[number]['taskQueueName']
    runStep: Step<TaskQueueArray[number]['taskQueueName']>['runStep']
  }>
}
