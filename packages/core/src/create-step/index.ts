import { ExecutionStatus } from '@era-ci/utils'
import { EMPTY, from, Observable } from 'rxjs'
import { ConstrainResultType, runConstrains } from '../create-constrain'
import { TaskQueueBase } from '../create-task-queue'
import { Actions, State } from '../steps-execution'
import { ExecutionActionTypes } from '../steps-execution/actions'
import { setupArtifactCallback } from './on-artifact'
import { setupStepCallback } from './on-step'
import { CreateStepOptions, Step, UserRunStepOptions } from './types'
import { artifactsEventsAbort } from './utils'

export * from './types'
export { stepToString, toStepsResultOfArtifactsByArtifact } from './utils'

export function createStep<
  TaskQueue extends TaskQueueBase<any, any>,
  StepConfigurations = void,
  NormalizedStepConfigurations = StepConfigurations
>(createStepOptions: CreateStepOptions<TaskQueue, StepConfigurations, NormalizedStepConfigurations>) {
  return (stepConfigurations: StepConfigurations): Step<TaskQueue> => {
    return {
      stepName: createStepOptions.stepName,
      stepGroup: createStepOptions.stepGroup,
      taskQueueClass: createStepOptions.taskQueueClass,
      runStep: async (runStepOptions, getState) => {
        const log = runStepOptions.logger.createLog(runStepOptions.currentStepInfo.data.stepInfo.stepName)

        const startStepMs = Date.now()

        // @ts-ignore - we need to find a way to ensure that if NormalizedStepConfigurations is defined, also normalizeStepConfigurations is defined.
        const normalizedStepConfigurations: NormalizedStepConfigurations = createStepOptions.normalizeStepConfigurations
          ? await createStepOptions.normalizeStepConfigurations(stepConfigurations, runStepOptions)
          : stepConfigurations

        const userRunStepOptions: UserRunStepOptions<TaskQueue, NormalizedStepConfigurations> = {
          ...runStepOptions,
          log,
          startStepMs,
          stepConfigurations: normalizedStepConfigurations,
          getState,
        }

        const prepareResult =
          (await createStepOptions.run(userRunStepOptions)) || Promise.resolve({ stepLogic: () => Promise.resolve() })

        const { globalConstrains = [] } = prepareResult

        const globalConstrainsResult = await runConstrains({
          ...userRunStepOptions,
          constrains: globalConstrains,
          log: userRunStepOptions.log,
          logPrefix: `global-constrain`,
        })

        if (globalConstrainsResult.combinedResultType === ConstrainResultType.shouldSkip) {
          let sent = false
          return () => {
            if (!sent) {
              sent = true
              const events: Actions[] = [
                ...artifactsEventsAbort({
                  step: userRunStepOptions.currentStepInfo,
                  artifacts: userRunStepOptions.artifacts,
                  startStepMs: userRunStepOptions.startStepMs,
                  status: globalConstrainsResult.combinedResult.status,
                }),
                {
                  type: ExecutionActionTypes.step,
                  payload: {
                    step: userRunStepOptions.currentStepInfo,
                    stepResult: {
                      durationMs: Date.now() - userRunStepOptions.startStepMs,
                      ...globalConstrainsResult.combinedResult,
                    },
                  },
                },
              ]
              return from(events)
            } else {
              return EMPTY
            }
          }
        }

        let onAction: (action: Actions, getState: () => State) => Observable<Actions>

        if ('onArtifact' in prepareResult) {
          onAction = await setupArtifactCallback({
            startStepMs: userRunStepOptions.startStepMs,
            userRunStepOptions,
            ...prepareResult,
          })
        } else {
          onAction = await setupStepCallback({
            startStepMs: userRunStepOptions.startStepMs,
            userRunStepOptions,
            ...prepareResult,
          })
        }

        function isStepRecursiveParent(stepIndex: number, possibleParentIndex: number): boolean {
          return (
            userRunStepOptions.steps[stepIndex].parentsIndexes.includes(possibleParentIndex) ||
            userRunStepOptions.steps[stepIndex].parentsIndexes.some(p => isStepRecursiveParent(p, possibleParentIndex))
          )
        }

        return (action, getState) => {
          // only allow events from recuresive-parent-steps or scheduled-events from current step.
          switch (action.type) {
            case ExecutionActionTypes.step:
              if (
                isStepRecursiveParent(userRunStepOptions.currentStepInfo.index, action.payload.step.index) ||
                (action.payload.step.index === userRunStepOptions.currentStepInfo.index &&
                  action.payload.stepResult.executionStatus === ExecutionStatus.scheduled)
              ) {
                return onAction(action, getState)
              }
              break
            case ExecutionActionTypes.artifactStep: {
              if (
                isStepRecursiveParent(userRunStepOptions.currentStepInfo.index, action.payload.step.index) ||
                (action.payload.step.index === userRunStepOptions.currentStepInfo.index &&
                  action.payload.artifactStepResult.executionStatus === ExecutionStatus.scheduled)
              ) {
                return onAction(action, getState)
              }
              break
            }
          }
          return EMPTY
        }
      },
    }
  }
}
