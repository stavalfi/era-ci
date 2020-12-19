import { ExecutionStatus, Status } from '@tahini/utils'
import { from, Observable } from 'rxjs'
import { first } from 'rxjs/operators'
import { serializeError } from 'serialize-error'
import { ConstrainResultType, runConstrains } from '../../create-constrain'
import { TaskQueueBase } from '../../create-task-queue'
import { StepFunctions, StepOutputEvents, StepOutputEventType, UserRunStepOptions } from '../types'
import {
  areRecursiveParentStepsFinished,
  artifactsEventsAbort,
  artifactsEventsDone,
  artifactsEventsRunning,
  stepEventDone,
  stepEventRunning,
} from './utils'

export async function runStepFunctions<TaskQueue extends TaskQueueBase<unknown>, StepConfigurations>({
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

  const event: StepOutputEvents[StepOutputEventType.step] = await (stepLogic ? stepLogic() : Promise.resolve()).then(
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

  if (event.stepResult.executionStatus !== ExecutionStatus.done) {
    throw new Error(`we can't be here11`)
  }

  return from([
    stepEventRunning({ step: userRunStepOptions.currentStepInfo }),
    ...artifactsEventsRunning({
      step: userRunStepOptions.currentStepInfo,
      artifacts: userRunStepOptions.artifacts,
    }),
    ...artifactsEventsDone({
      step: userRunStepOptions.currentStepInfo,
      artifacts: userRunStepOptions.artifacts,
      startStepMs: userRunStepOptions.startStepMs,
      status: event.stepResult.status,
    }),
    event,
  ])
}
