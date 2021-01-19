import { ExecutionStatus, Status } from '@era-ci/utils'
import { defer, EMPTY, from, Observable } from 'rxjs'
import { concatMap } from 'rxjs/operators'
import { serializeError } from 'serialize-error'
import { CombinedConstrainResult, ConstrainResultType, runConstrains } from '../../create-constrain'
import { TaskQueueBase } from '../../create-task-queue'
import { Actions, ChangeArtifactStatusAction, ChangeStepStatusAction, State } from '../../steps-execution'
import { ExecutionActionTypes } from '../../steps-execution/actions'
import { StepFunctions, UserRunStepOptions } from '../types'
import {
  areRecursiveParentStepsFinished,
  artifactsEventsAbort,
  artifactsEventsDone,
  artifactsEventsRunning,
  stepEventDone,
  stepEventRunning,
} from './utils'

export async function setupStepCallback<TaskQueue extends TaskQueueBase<any, any>, StepConfigurations>({
  startStepMs,
  userRunStepOptions,
  stepConstrains = [],
  stepLogic = () => Promise.resolve(),
}: {
  startStepMs: number
  userRunStepOptions: UserRunStepOptions<TaskQueue, StepConfigurations>
} & StepFunctions<StepConfigurations>): Promise<(action: Actions, getState: () => State) => Observable<Actions>> {
  let didRun = false
  return (_action, getState) => {
    if (
      !areRecursiveParentStepsFinished({
        stepsResultOfArtifactsByStep: getState().stepsResultOfArtifactsByStep,
        stepIndex: userRunStepOptions.currentStepInfo.index,
      })
    ) {
      return EMPTY
    }

    if (didRun) {
      return EMPTY
    }
    didRun = true

    return defer(() =>
      runConstrains({
        ...userRunStepOptions,
        constrains: stepConstrains,
        logPrefix: `step-constrain`,
        getState,
      }),
    ).pipe(
      concatMap<CombinedConstrainResult, Observable<Actions>>(stepConstrainsResult => {
        if (stepConstrainsResult.combinedResultType === ConstrainResultType.shouldSkip) {
          const events: (ChangeArtifactStatusAction | ChangeStepStatusAction)[] = [
            ...artifactsEventsAbort({
              artifacts: userRunStepOptions.artifacts,
              startStepMs: userRunStepOptions.startStepMs,
              step: userRunStepOptions.currentStepInfo,
              status: stepConstrainsResult.combinedResult.status,
            }),
            {
              type: ExecutionActionTypes.step,
              payload: {
                step: userRunStepOptions.currentStepInfo,
                stepResult: {
                  durationMs: Date.now() - startStepMs,
                  ...stepConstrainsResult.combinedResult,
                },
              },
            },
          ]
          return from(events)
        } else {
          return new Observable(observer => {
            observer.next(stepEventRunning({ step: userRunStepOptions.currentStepInfo }))
            artifactsEventsRunning({
              step: userRunStepOptions.currentStepInfo,
              artifacts: userRunStepOptions.artifacts,
            }).forEach(e => observer.next(e))

            const logic = stepLogic ? stepLogic() : Promise.resolve()
            logic
              .then<ChangeStepStatusAction, ChangeStepStatusAction>(
                r =>
                  r
                    ? {
                        type: ExecutionActionTypes.step,
                        payload: {
                          step: userRunStepOptions.currentStepInfo,
                          stepResult: {
                            durationMs: Date.now() - startStepMs,
                            errors: [],
                            notes: [],
                            ...r,
                          },
                        },
                      }
                    : stepEventDone({
                        step: userRunStepOptions.currentStepInfo,
                        startStepMs: userRunStepOptions.startStepMs,
                      }),
                error => ({
                  type: ExecutionActionTypes.step,
                  payload: {
                    step: userRunStepOptions.currentStepInfo,
                    stepResult: {
                      durationMs: Date.now() - startStepMs,
                      executionStatus: ExecutionStatus.done,
                      status: Status.failed,
                      errors: [serializeError(error)],
                      notes: [],
                    },
                  },
                }),
              )
              .then(event => {
                switch (event.payload.stepResult.executionStatus) {
                  case ExecutionStatus.done:
                    artifactsEventsDone({
                      step: userRunStepOptions.currentStepInfo,
                      artifacts: userRunStepOptions.artifacts,
                      startStepMs: userRunStepOptions.startStepMs,
                      status: event.payload.stepResult.status,
                    }).forEach(e => observer.next(e))
                    observer.next(event)
                    break
                  case ExecutionStatus.aborted:
                    artifactsEventsAbort({
                      step: userRunStepOptions.currentStepInfo,
                      artifacts: userRunStepOptions.artifacts,
                      startStepMs: userRunStepOptions.startStepMs,
                      status: event.payload.stepResult.status,
                    }).forEach(e => observer.next(e))
                    observer.next(event)
                    break
                  default:
                    throw new Error(`we can't be here11`)
                }
                observer.complete()
              })
          })
        }
      }),
    )
  }
}
