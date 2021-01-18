import { Graph, StepInfo } from '@era-ci/utils'
import { Log } from '../create-logger'
import { RunStepOptions, StepExperimental } from '../create-step'
import { TaskQueueBase, TaskQueueOptions } from '../create-task-queue'

export type Options = {
  log: Log
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  taskQueues: Array<TaskQueueBase<any, any>>
  stepsToRun: Graph<{
    stepInfo: StepInfo
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    taskQueueClass: { new (options: TaskQueueOptions<any>): any }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runStep: StepExperimental<any>['runStep']
  }>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} & Omit<RunStepOptions<TaskQueueBase<any, any>>, 'currentStepInfo' | 'taskQueue' | 'getState'>
