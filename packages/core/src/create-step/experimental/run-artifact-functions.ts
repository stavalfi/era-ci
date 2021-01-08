import { ExecutionStatus, Status, StepOutputEvents, StepOutputEventType } from '@era-ci/utils'
import { queue } from 'async'
import { Observable, of, Subject } from 'rxjs'
import { first, mergeMap } from 'rxjs/operators'
import { serializeError } from 'serialize-error'
import { CombinedConstrainResult, ConstrainResultType, runConstrains } from '../../create-constrain'
import { TaskQueueBase } from '../../create-task-queue'
import { ArtifactFunctions, UserRunStepOptions } from '../types'
import {
  areArtifactParentsFinishedParentSteps,
  areRecursiveParentStepsFinishedOnArtifact,
  artifactsEventsDone,
  calculateCombinedStatusOfCurrentStep,
} from './utils'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function runArtifactFunctions<TaskQueue extends TaskQueueBase<any, any>, StepConfigurations>({
  allStepsEventsRecorded$,
  startStepMs,
  userRunStepOptions,
  artifactConstrains = [],
  onBeforeArtifacts = () => Promise.resolve(),
  onArtifact = () => Promise.resolve(),
  onAfterArtifacts = () => Promise.resolve(),
  waitUntilArtifactParentsFinishedParentSteps,
}: {
  allStepsEventsRecorded$: Observable<StepOutputEvents[StepOutputEventType]>
  startStepMs: number
  userRunStepOptions: UserRunStepOptions<TaskQueue, StepConfigurations>
} & ArtifactFunctions<StepConfigurations>): Observable<StepOutputEvents[StepOutputEventType]> {
  if (userRunStepOptions.artifacts.length === 0) {
    return of({
      type: StepOutputEventType.step,
      step: userRunStepOptions.currentStepInfo,
      stepResult: {
        durationMs: Date.now() - startStepMs,
        executionStatus: ExecutionStatus.aborted,
        status: Status.skippedAsPassed,
        errors: [],
        notes: [],
      },
    })
  }

  let didRunBeforeAll = false
  const beforeAllQueue = queue<void>(async (_, done) => {
    if (!didRunBeforeAll) {
      didRunBeforeAll = true
      await onBeforeArtifacts()
      userRunStepOptions.log.trace(`finished onBeforeArtifacts function`)
    }
    done()
  }, 1)

  let didRunAfterAll = false
  const afterAllQueue = queue<void>(async (_, done) => {
    if (!didRunAfterAll) {
      didRunAfterAll = true
      await onAfterArtifacts()
      userRunStepOptions.log.trace(`finished onAfterArtifacts function`)
    }
    done()
  }, 1)

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

  const didArtifactRunConstain = userRunStepOptions.artifacts.map(() => false)

  const areAllArtifactsFinished = (): boolean =>
    artifactResultsOnCurrentStep.every(a =>
      [ExecutionStatus.aborted, ExecutionStatus.done].includes(a.artifactStepResult.executionStatus),
    )

  let didSendStepRunning = false

  const stepEvents$ = new Subject<StepOutputEvents[StepOutputEventType]>()

  allStepsEventsRecorded$
    .pipe(
      mergeMap(event => {
        return new Observable<StepOutputEvents[StepOutputEventType.artifactStep]>(observer => {
          if (event.type !== StepOutputEventType.artifactStep) {
            observer.complete()
            return
          }

          if (!waitUntilArtifactParentsFinishedParentSteps) {
            observer.next(event)
            observer.complete()
            return
          }

          const artifactParentsFinishedParentStep = areArtifactParentsFinishedParentSteps({
            artifactIndex: event.artifact.index,
            artifacts: userRunStepOptions.artifacts,
            stepIndex: userRunStepOptions.currentStepInfo.index,
            stepsResultOfArtifactsByStep: userRunStepOptions.getState().stepsResultOfArtifactsByStep,
          })

          if (artifactParentsFinishedParentStep) {
            observer.next(event)
          }

          for (const childIndex of event.artifact.childrenIndexes) {
            const artifactParentsFinishedParentStep = areArtifactParentsFinishedParentSteps({
              artifactIndex: childIndex,
              artifacts: userRunStepOptions.artifacts,
              stepIndex: userRunStepOptions.currentStepInfo.index,
              stepsResultOfArtifactsByStep: userRunStepOptions.getState().stepsResultOfArtifactsByStep,
            })
            const childResult = userRunStepOptions.getState().stepsResultOfArtifactsByStep[
              userRunStepOptions.currentStepInfo.index
            ].data.artifactsResult[childIndex].data.artifactStepResult
            if (artifactParentsFinishedParentStep && childResult.executionStatus === ExecutionStatus.scheduled) {
              observer.next({
                type: StepOutputEventType.artifactStep,
                step: userRunStepOptions.currentStepInfo,
                artifact: userRunStepOptions.artifacts[childIndex],
                artifactStepResult: childResult,
              })
            }
          }
          observer.complete()
        })
      }),
      mergeMap(async event => {
        const artifactExecutionStatus =
          artifactResultsOnCurrentStep[event.artifact.index].artifactStepResult.executionStatus
        const artifactRunConstain = didArtifactRunConstain[event.artifact.index]
        const recursiveParentStepsFinishedOnArtifact = areRecursiveParentStepsFinishedOnArtifact({
          artifactIndex: event.artifact.index,
          steps: userRunStepOptions.steps,
          stepIndex: userRunStepOptions.currentStepInfo.index,
          stepsResultOfArtifactsByArtifact: userRunStepOptions.getState().stepsResultOfArtifactsByArtifact,
        })
        if (
          artifactExecutionStatus === ExecutionStatus.scheduled &&
          !artifactRunConstain && // prevent duplicate concurrent entries to this function (for the same artifact)
          recursiveParentStepsFinishedOnArtifact
        ) {
          didArtifactRunConstain[event.artifact.index] = true
          const artifactConstrainsResult: CombinedConstrainResult = await runConstrains({
            ...userRunStepOptions,
            constrains: artifactConstrains.map(c => c(event.artifact)),
            artifactName: event.artifact.data.artifact.packageJson.name,
            logPrefix: `artifact-constrain`,
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

            const isStepAborted = artifactResultsOnCurrentStep.every(
              a => a.artifactStepResult.executionStatus === ExecutionStatus.aborted,
            )
            if (isStepAborted) {
              const status = calculateCombinedStatusOfCurrentStep(artifactResultsOnCurrentStep)
              if (status === Status.failed || status === Status.passed) {
                throw new Error(`we can't be here8`)
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
            } else {
              const didStepDone = artifactResultsOnCurrentStep.every(
                a =>
                  a.artifactStepResult.executionStatus === ExecutionStatus.aborted ||
                  a.artifactStepResult.executionStatus === ExecutionStatus.done,
              )
              if (didStepDone) {
                const status = calculateCombinedStatusOfCurrentStep(artifactResultsOnCurrentStep)
                if (status === Status.skippedAsFailed || status === Status.skippedAsPassed) {
                  throw new Error(`we can't be here8`)
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
                    status: Status.passed,
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

            const isStepAborted = artifactResultsOnCurrentStep.every(
              a => a.artifactStepResult.executionStatus === ExecutionStatus.aborted,
            )
            if (isStepAborted) {
              const status = calculateCombinedStatusOfCurrentStep(artifactResultsOnCurrentStep)
              if (status === Status.passed) {
                throw new Error(`we can't be here9`)
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
              return true
            } else {
              const status = calculateCombinedStatusOfCurrentStep(artifactResultsOnCurrentStep)
              if (status === Status.skippedAsFailed || status === Status.skippedAsPassed) {
                throw new Error(`we can't be here10`)
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
        }
        return areAllArtifactsFinished()
      }),
      first(areAllArtifactsFinished => areAllArtifactsFinished),
    )
    .subscribe()

  return stepEvents$
}
