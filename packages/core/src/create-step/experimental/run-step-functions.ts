import { ExecutionStatus, Status, StepOutputEvents, StepOutputEventType } from '@era-ci/utils'
import { from, Observable } from 'rxjs'
import { first } from 'rxjs/operators'
import { serializeError } from 'serialize-error'
import { ConstrainResultType, runConstrains } from '../../create-constrain'
import { TaskQueueBase } from '../../create-task-queue'
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
  allStepsEventsRecorded$: Observable<StepOutputEvents[StepOutputEventType]>
  startStepMs: number
  userRunStepOptions: UserRunStepOptions<TaskQueue, StepConfigurations>
} & StepFunctions<StepConfigurations>): Promise<Observable<StepOutputEvents[StepOutputEventType]>> {
  await allStepsEventsRecorded$
    .pipe(
      first(() =>
        areRecursiveParentStepsFinished({
          stepsResultOfArtifactsByStep: userRunStepOptions.getState().stepsResultOfArtifactsByStep,
          stepIndex: userRunStepOptions.currentStepInfo.index,
        }),
      ),
    )
    .toPromise()

  const stepConstrainsResult = await runConstrains({
    ...userRunStepOptions,
    constrains: stepConstrains,
    logPrefix: `step-constrain`,
  })

  if (stepConstrainsResult.combinedResultType === ConstrainResultType.shouldSkip) {
    const events: (
      | StepOutputEvents[StepOutputEventType.artifactStep]
      | StepOutputEvents[StepOutputEventType.step]
    )[] = [
      ...artifactsEventsAbort({
        artifacts: userRunStepOptions.artifacts,
        startStepMs: userRunStepOptions.startStepMs,
        step: userRunStepOptions.currentStepInfo,
        status: stepConstrainsResult.combinedResult.status,
      }),
      {
        type: StepOutputEventType.step,
        step: userRunStepOptions.currentStepInfo,
        stepResult: {
          durationMs: Date.now() - startStepMs,
          ...stepConstrainsResult.combinedResult,
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
      .then<StepOutputEvents[StepOutputEventType.step], StepOutputEvents[StepOutputEventType.step]>(
        r =>
          r
            ? {
                type: StepOutputEventType.step,
                step: userRunStepOptions.currentStepInfo,
                stepResult: {
                  durationMs: Date.now() - startStepMs,
                  errors: [],
                  notes: [],
                  ...r,
                },
              }
            : stepEventDone({ step: userRunStepOptions.currentStepInfo, startStepMs: userRunStepOptions.startStepMs }),
        error => ({
          type: StepOutputEventType.step,
          step: userRunStepOptions.currentStepInfo,
          stepResult: {
            durationMs: Date.now() - startStepMs,
            executionStatus: ExecutionStatus.done,
            status: Status.failed,
            errors: [serializeError(error)],
            notes: [],
          },
        }),
      )
      .then(event => {
        switch (event.stepResult.executionStatus) {
          case ExecutionStatus.done:
            artifactsEventsDone({
              step: userRunStepOptions.currentStepInfo,
              artifacts: userRunStepOptions.artifacts,
              startStepMs: userRunStepOptions.startStepMs,
              status: event.stepResult.status,
            }).forEach(e => observer.next(e))
            observer.next(event)
            break
          case ExecutionStatus.aborted:
            artifactsEventsAbort({
              step: userRunStepOptions.currentStepInfo,
              artifacts: userRunStepOptions.artifacts,
              startStepMs: userRunStepOptions.startStepMs,
              status: event.stepResult.status,
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
