import { StepExperimental, StepInfo, TaskQueueBase, TaskQueueOptions } from '@era-ci/core'
import { Graph } from '@era-ci/utils'

export type Steps<TaskQueueConfigurations> = Graph<{
  stepInfo: StepInfo
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  taskQueueClass: { new (options: TaskQueueOptions<TaskQueueConfigurations>): any }
  runStep: StepExperimental<TaskQueueBase<TaskQueueConfigurations>>['runStep']
}>
