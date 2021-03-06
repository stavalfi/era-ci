import { Step, TaskQueueBase, TaskQueueOptions } from '@era-ci/core'
import { StepInfo } from '@era-ci/utils'
import { Graph } from '@era-ci/utils'

export type Steps<TaskQueueConfigurations, TaskPayload> = Graph<{
  stepInfo: StepInfo

  taskQueueClass: { new (options: TaskQueueOptions<TaskQueueConfigurations>): any }
  runStep: Step<TaskQueueBase<TaskQueueConfigurations, TaskPayload>>['runStep']
}>
