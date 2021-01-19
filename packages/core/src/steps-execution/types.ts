import { Graph, StepInfo } from '@era-ci/utils'
import { Observable } from 'rxjs'
import { Log } from '../create-logger'
import { RunStepOptions } from '../create-step'
import { TaskQueueBase, TaskQueueOptions } from '../create-task-queue'
import { Actions } from './actions'
import { State } from './state'

export type Options = {
  log: Log
  taskQueues: Array<TaskQueueBase<any, any>>
  stepsToRun: Graph<{
    stepInfo: StepInfo
    taskQueueClass: { new (options: TaskQueueOptions<any>): any }
    runStep: (
      runStepOptions: RunStepOptions<TaskQueueBase<any, any>>,
    ) => Promise<(action: Actions, getState: () => State) => Observable<Actions>>
  }>
} & Omit<RunStepOptions<TaskQueueBase<any, any>>, 'currentStepInfo' | 'taskQueue'>
