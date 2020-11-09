import { CreateKeyValueStoreConnection } from '../create-key-value-store-connection'
import { CreateLogger } from '../create-logger'
import { Step, StepInfo } from '../create-step'
import { ConfigureTaskQueue, CreateTaskQueue, TaskQueueBase } from '../create-task-queue'
import { Graph } from '../types'

export type Config<TaskQueueName extends string, TaskQueue extends TaskQueueBase<TaskQueueName>> = {
  keyValueStore: CreateKeyValueStoreConnection
  logger: CreateLogger
  taskQueues: Array<CreateTaskQueue<TaskQueueName, TaskQueue>>
  steps: Graph<{
    stepInfo: StepInfo
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    configureTaskQueue: ConfigureTaskQueue<TaskQueueName, TaskQueue, any>
    runStep: Step<TaskQueueName, TaskQueue>['runStep']
  }>
}
