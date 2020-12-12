import { EMPTY } from 'rxjs'
import { TaskQueueBase } from '../create-task-queue'
import { CreateStepOptionsExperimental, StepExperimental } from './types'

export function createStepExperimental<
  TaskQueue extends TaskQueueBase<unknown>,
  StepConfigurations = void,
  NormalizedStepConfigurations = StepConfigurations
>(createStepOptions: CreateStepOptionsExperimental<TaskQueue, StepConfigurations, NormalizedStepConfigurations>) {
  return (stepConfigurations: StepConfigurations): StepExperimental<TaskQueue> => ({
    stepName: createStepOptions.stepName,
    taskQueueClass: createStepOptions.taskQueueClass,
    runStep: runStepOptions => {
      //   const startStepMs = Date.now()
      //   // @ts-ignore - we need to find a way to ensure that if NormalizedStepConfigurations is defined, also normalizeStepConfigurations is defined.
      //   const normalizedStepConfigurations: NormalizedStepConfigurations = createStepOptions.normalizeStepConfigurations
      //     ? await createStepOptions.normalizeStepConfigurations(stepConfigurations)
      //     : stepConfigurations

      return EMPTY
    },
  })
}
