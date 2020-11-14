import { CreateKeyValueStoreConnection } from '../create-key-value-store-connection'
import { CreateLogger } from '../create-logger'
import { Step, StepInfo } from '../create-step'
import { CreateTaskQueue, TaskQueueOptions } from '../create-task-queue'
import { Graph } from '../types'

export type Config<TaskQueueConfigurations> = {
  keyValueStore: CreateKeyValueStoreConnection
  logger: CreateLogger
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  taskQueues: Array<CreateTaskQueue<TaskQueueConfigurations, any>>
  steps: Graph<{
    stepInfo: StepInfo
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    taskQueueClass: { new (options: TaskQueueOptions<TaskQueueConfigurations>): any }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runStep: Step<any>['runStep']
  }>
}
