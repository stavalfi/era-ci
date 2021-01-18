import { ExecutionStatus, Status, StepOutputEventType } from '@era-ci/utils'
import { firstValueFrom, from, Observable } from 'rxjs'
import { first } from 'rxjs/operators'
import { serializeError } from 'serialize-error'
import { ConstrainResultType, runConstrains } from '../../create-constrain'
import { TaskQueueBase } from '../../create-task-queue'
import { Actions, ChangeArtifactStatusAction, ChangeStepStatusAction } from '../../steps-execution'
import { StepFunctions, UserRunStepOptions } from '../types'
import {
  areRecursiveParentStepsFinished,
  artifactsEventsAbort,
  artifactsEventsDone,
  artifactsEventsRunning,
  stepEventDone,
  stepEventRunning,
} from './utils'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function runStepFunctions<TaskQueue extends TaskQueueBase<any, any>, StepConfigurations>({
  allStepsEventsRecorded$,
  startStepMs,
  userRunStepOptions,
  stepConstrains = [],
  stepLogic = () => Promise.resolve(),
}: {
  allStepsEventsRecorded$: Observable<Actions>
  startStepMs: number
  userRunStepOptions: UserRunStepOptions<TaskQueue, StepConfigurations>
} & StepFunctions<StepConfigurations>): Promise<Observable<Actions>> {
  await firstValueFrom(
    allStepsEventsRecorded$.pipe(
      first(() =>
        areRecursiveParentStepsFinished({
          stepsResultOfArtifactsByStep: userRunStepOptions.getState().stepsResultOfArtifactsByStep,
          stepIndex: userRunStepOptions.currentStepInfo.index,
        }),
      ),
    ),
  )

  const stepConstrainsResult = await runConstrains({
    ...userRunStepOptions,
    constrains: stepConstrains,
    logPrefix: `step-constrain`,
  })

  if (stepConstrainsResult.combinedResultType === ConstrainResultType.shouldSkip) {
    const events: (ChangeArtifactStatusAction | ChangeStepStatusAction)[] = [
      ...artifactsEventsAbort({
        artifacts: userRunStepOptions.artifacts,
        startStepMs: userRunStepOptions.startStepMs,
        step: userRunStepOptions.currentStepInfo,
        status: stepConstrainsResult.combinedResult.status,
      }),
      {
        type: StepOutputEventType.step,
        payload: {
          type: StepOutputEventType.step,
          step: userRunStepOptions.currentStepInfo,
          stepResult: {
            durationMs: Date.now() - startStepMs,
            ...stepConstrainsResult.combinedResult,
          },
        },
      },
    ]
    return from(events)
  }

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
                type: StepOutputEventType.step,
                payload: {
                  type: StepOutputEventType.step,
                  step: userRunStepOptions.currentStepInfo,
                  stepResult: {
                    durationMs: Date.now() - startStepMs,
                    errors: [],
                    notes: [],
                    ...r,
                  },
                },
              }
            : stepEventDone({ step: userRunStepOptions.currentStepInfo, startStepMs: userRunStepOptions.startStepMs }),
        error => ({
          type: StepOutputEventType.step,
          payload: {
            type: StepOutputEventType.step,
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
