import { Graph, StepInfo } from '@era-ci/utils'
import { Observable } from 'rxjs'
import { CreateLogger } from '../create-logger'
import { RunStepOptions } from '../create-step'
import { CreateTaskQueue, TaskQueueBase, TaskQueueOptions } from '../create-task-queue'
import { RedisConfiguration } from '../redis-client'
import { Actions, State } from '../steps-execution'

export type Config<TaskQueueConfigurations> = {
  redis: RedisConfiguration
  logger: CreateLogger
  taskQueues: Array<{
    taskQueueName: string
    createFunc: CreateTaskQueue<TaskQueueConfigurations, any, any>
  }>
  steps: Graph<{
    stepInfo: StepInfo
    taskQueueClass: { new (options: TaskQueueOptions<TaskQueueConfigurations>): any }
    runStep: (
      runStepOptions: RunStepOptions<TaskQueueBase<any, any>>,
      getState: () => State,
    ) => Promise<(action: Actions, getState: () => State) => Observable<Actions>>
  }>
}
