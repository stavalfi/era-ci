import { Graph } from '@era-ci/utils'
import { CreateLogger } from '../create-logger'
import { StepExperimental, StepInfo } from '../create-step'
import { CreateTaskQueue, TaskQueueOptions } from '../create-task-queue'
import { RedisConfiguration } from '../redis-client'

export type Config<TaskQueueConfigurations> = {
  redis: RedisConfiguration
  logger: CreateLogger
  taskQueues: Array<{
    taskQueueName: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createFunc: CreateTaskQueue<TaskQueueConfigurations, any>
  }>
  steps: Graph<{
    stepInfo: StepInfo
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    taskQueueClass: { new (options: TaskQueueOptions<TaskQueueConfigurations>): any }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runStep: StepExperimental<any>['runStep']
  }>
}
