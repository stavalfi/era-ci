import { ExecutionStatus, Status } from '@tahini/utils'
import { from, Observable } from 'rxjs'
import { first } from 'rxjs/operators'
import { serializeError } from 'serialize-error'
import { ConstrainResultType, runConstrains } from '../../create-constrain'
import { TaskQueueBase } from '../../create-task-queue'
import { StepFunctions, StepOutputEvents, StepOutputEventType, UserRunStepOptions } from '../types'
import { artifactsEventsDone, artifactsEventsRunning, stepEventDone, stepEventRunning } from './utils'

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
        userRunStepOptions.currentStepInfo.parentsIndexes.every(parentIndex =>
          [ExecutionStatus.aborted, ExecutionStatus.done].includes(
            userRunStepOptions.getState().stepsResultOfArtifactsByStep[parentIndex].data.stepExecutionStatus,
          ),
        ),
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
      stepEventRunning({ step: userRunStepOptions.currentStepInfo }),
      ...artifactsEventsRunning({ artifacts: userRunStepOptions.artifacts, step: userRunStepOptions.currentStepInfo }),
      ...artifactsEventsDone({
        artifacts: userRunStepOptions.artifacts,
        startStepMs: userRunStepOptions.startStepMs,
        step: userRunStepOptions.currentStepInfo,
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
    throw new Error(`we can't be here`)
  }
  if (event.stepResult.status === Status.passed) {
    return from([
      stepEventRunning({ step: userRunStepOptions.currentStepInfo }),
      ...artifactsEventsDone({
        step: userRunStepOptions.currentStepInfo,
        artifacts: userRunStepOptions.artifacts,
        startStepMs: userRunStepOptions.startStepMs,
      }),
      event,
    ])
  } else {
    return from([
      stepEventRunning({ step: userRunStepOptions.currentStepInfo }),
      ...artifactsEventsDone({
        step: userRunStepOptions.currentStepInfo,
        artifacts: userRunStepOptions.artifacts,
        startStepMs: userRunStepOptions.startStepMs,
        asFailed: true,
      }),
      event,
    ])
  }
}
