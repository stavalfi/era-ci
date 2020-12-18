import { ExecutionStatus, Status } from '@tahini/utils'
import { queue } from 'async'
import { Observable, Subject } from 'rxjs'
import { first, mergeMap } from 'rxjs/operators'
import { serializeError } from 'serialize-error'
import { ConstrainResultType, runConstrains } from '../../create-constrain'
import { TaskQueueBase } from '../../create-task-queue'
import { ArtifactFunctions, StepOutputEvents, StepOutputEventType, UserRunStepOptions } from '../types'
import {
  areStepsDoneOnArtifact,
  artifactsEventsDone,
  calculateCombinedStatusOfCurrentStep,
  didAllStepsAborted,
} from './utils'

export function runArtifactFunctions<TaskQueue extends TaskQueueBase<unknown>, StepConfigurations>({
  allStepsEventsRecorded$,
  startStepMs,
  userRunStepOptions,
  artifactConstrains = [],
  onBeforeArtifacts = () => Promise.resolve(),
  onArtifact = () => Promise.resolve(),
  onAfterArtifacts = () => Promise.resolve(),
}: {
  allStepsEventsRecorded$: Observable<StepOutputEvents[StepOutputEventType]>
  startStepMs: number
  userRunStepOptions: UserRunStepOptions<TaskQueue, StepConfigurations>
} & ArtifactFunctions<StepConfigurations>): Observable<StepOutputEvents[StepOutputEventType]> {
  let didRunBeforeAll = false
  const beforeAllQueue = queue<void>(async (_, done) => {
    if (didRunBeforeAll) {
      didRunBeforeAll = true
      await onBeforeArtifacts()
    }
    done()
  }, 1)

  let didRunAfterAll = false
  const afterAllQueue = queue<void>(async (_, done) => {
    if (didRunAfterAll) {
      didRunAfterAll = true
      await onAfterArtifacts()
    }
    done()
  }, 1)

  const stepEvents$ = new Subject<StepOutputEvents[StepOutputEventType]>()

  // each step needs to have an internal state because I can't count on
  // `userRunStepOptions.stepsResultOfArtifactsByStep[userRunStepOptions.curentStep.index]`
  // to be updated at all
  const artifactResultsOnCurrentStep: StepOutputEvents[StepOutputEventType.artifactStep][] = userRunStepOptions.artifacts.map(
    artifact => ({
      type: StepOutputEventType.artifactStep,
      artifact,
      step: userRunStepOptions.currentStepInfo,
      artifactStepResult: {
        executionStatus: ExecutionStatus.scheduled,
      },
    }),
  )

  const areAllArtifactsFinished = (): boolean =>
    artifactResultsOnCurrentStep.every(a =>
      [ExecutionStatus.aborted, ExecutionStatus.done].includes(a.artifactStepResult.executionStatus),
    )

  let didSendStepRunning = false

  allStepsEventsRecorded$
    .pipe(
      mergeMap(async event => {
        if (
          event.type === StepOutputEventType.artifactStep &&
          areStepsDoneOnArtifact({
            artifactIndex: event.artifact.index,
            step: userRunStepOptions.currentStepInfo,
            stepsResultOfArtifactsByArtifact: userRunStepOptions.getState().stepsResultOfArtifactsByArtifact,
          })
        ) {
          const artifactConstrainsResult = await runConstrains({
            ...userRunStepOptions,
            constrains: artifactConstrains.map(c => c(event.artifact)),
          })
          if (artifactConstrainsResult.combinedResultType === ConstrainResultType.shouldSkip) {
            const e: StepOutputEvents[StepOutputEventType.artifactStep] = {
              type: StepOutputEventType.artifactStep,
              artifact: event.artifact,
              step: userRunStepOptions.currentStepInfo,
              artifactStepResult: {
                durationMs: Date.now() - startStepMs,
                ...artifactConstrainsResult.combinedResult,
              },
            }
            artifactResultsOnCurrentStep[event.artifact.index] = e
            stepEvents$.next(e)

            if (
              didAllStepsAborted({
                currentStepInfo: userRunStepOptions.currentStepInfo,
                stepsResultOfArtifactsByStep: userRunStepOptions.getState().stepsResultOfArtifactsByStep,
              })
            ) {
              const status = calculateCombinedStatusOfCurrentStep(artifactResultsOnCurrentStep)
              if (status === Status.passed) {
                throw new Error(`we can't be here`)
              }
              stepEvents$.next({
                type: StepOutputEventType.step,
                step: userRunStepOptions.currentStepInfo,
                stepResult: {
                  durationMs: Date.now() - startStepMs,
                  executionStatus: ExecutionStatus.aborted,
                  status,
                  errors: [],
                  notes: [],
                },
              })
            }
            return areAllArtifactsFinished()
          }

          if (!didSendStepRunning) {
            didSendStepRunning = true
            stepEvents$.next({
              type: StepOutputEventType.step,
              step: userRunStepOptions.currentStepInfo,
              stepResult: {
                executionStatus: ExecutionStatus.running,
              },
            })
          }

          const eventRunning: StepOutputEvents[StepOutputEventType.artifactStep] = {
            type: StepOutputEventType.artifactStep,
            artifact: event.artifact,
            step: userRunStepOptions.currentStepInfo,
            artifactStepResult: {
              executionStatus: ExecutionStatus.running,
            },
          }
          stepEvents$.next(eventRunning)
          artifactResultsOnCurrentStep[event.artifact.index] = eventRunning

          await beforeAllQueue.push()

          const newEvent = await onArtifact({ artifact: event.artifact }).then<
            StepOutputEvents[StepOutputEventType.artifactStep],
            StepOutputEvents[StepOutputEventType.artifactStep]
          >(
            r =>
              r
                ? {
                    type: StepOutputEventType.artifactStep,
                    artifact: event.artifact,
                    step: userRunStepOptions.currentStepInfo,
                    artifactStepResult: {
                      durationMs: Date.now() - startStepMs,
                      errors: [],
                      notes: [],
                      ...r,
                    },
                  }
                : artifactsEventsDone({
                    artifacts: userRunStepOptions.artifacts,
                    startStepMs: userRunStepOptions.startStepMs,
                    step: userRunStepOptions.currentStepInfo,
                  })[event.artifact.index],
            error => ({
              type: StepOutputEventType.artifactStep,
              artifact: event.artifact,
              step: userRunStepOptions.currentStepInfo,
              artifactStepResult: {
                durationMs: Date.now() - startStepMs,
                executionStatus: ExecutionStatus.done,
                status: Status.failed,
                errors: [serializeError(error)],
                notes: [],
              },
            }),
          )

          stepEvents$.next(newEvent)
          artifactResultsOnCurrentStep[event.artifact.index] = newEvent

          if (areAllArtifactsFinished()) {
            await afterAllQueue.push()
            const status = calculateCombinedStatusOfCurrentStep(artifactResultsOnCurrentStep)
            if (status !== Status.passed && status !== Status.failed) {
              throw new Error(`we can't be here`)
            }
            stepEvents$.next({
              type: StepOutputEventType.step,
              step: userRunStepOptions.currentStepInfo,
              stepResult: {
                durationMs: Date.now() - startStepMs,
                executionStatus: ExecutionStatus.done,
                status,
                errors: [],
                notes: [],
              },
            })
          }
        }
        return areAllArtifactsFinished()
      }),
      first(areAllArtifactsFinished => areAllArtifactsFinished),
    )
    .subscribe()
  return stepEvents$
}
