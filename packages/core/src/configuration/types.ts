import type { Graph, StepInfo } from '@era-ci/utils'
import type { Observable } from 'rxjs'
import type { CreateLogger } from '../create-logger'
import type { RunStepOptions } from '../create-step'
import type { CreateTaskQueue, TaskQueueBase, TaskQueueOptions } from '../create-task-queue'
import type { RedisConfiguration } from '../redis-client'
import type { Actions, State } from '../steps-execution'

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
