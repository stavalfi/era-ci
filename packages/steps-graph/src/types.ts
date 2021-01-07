import { StepExperimental, TaskQueueBase, TaskQueueOptions } from '@era-ci/core'
import { StepInfo } from '@era-ci/utils'
import { Graph } from '@era-ci/utils'

export type Steps<TaskQueueConfigurations> = Graph<{
  stepInfo: StepInfo
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  taskQueueClass: { new (options: TaskQueueOptions<TaskQueueConfigurations>): any }
  runStep: StepExperimental<TaskQueueBase<TaskQueueConfigurations>>['runStep']
}>
