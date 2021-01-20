import { ExecutionStatus, Status } from '@era-ci/utils'
import { queue } from 'async'
import { Observable, of } from 'rxjs'
import { mergeMap } from 'rxjs/operators'
import { serializeError } from 'serialize-error'
import { CombinedConstrainResult, ConstrainResultType, runConstrains } from '../create-constrain'
import { TaskQueueBase } from '../create-task-queue'
import { Actions, ChangeArtifactStatusAction, State } from '../steps-execution'
import { ExecutionActionTypes } from '../steps-execution/actions'
import { ArtifactFunctions, UserRunStepOptions } from './types'
import {
  areArtifactParentsFinishedParentSteps,
  areRecursiveParentStepsFinishedOnArtifact,
  artifactsEventsAbort,
  artifactsEventsDone,
  calculateCombinedStatusOfCurrentStep,
} from './utils'

export async function setupArtifactCallback<TaskQueue extends TaskQueueBase<any, any>, StepConfigurations>({
  startStepMs,
  userRunStepOptions,
  artifactConstrains = [],
  onBeforeArtifacts = () => Promise.resolve(),
  onArtifact = () => Promise.resolve(),
  onAfterArtifacts = () => Promise.resolve(),
  waitUntilArtifactParentsFinishedParentSteps,
}: {
  startStepMs: number
  userRunStepOptions: UserRunStepOptions<TaskQueue, StepConfigurations>
} & ArtifactFunctions<StepConfigurations>): Promise<(action: Actions, getState: () => State) => Observable<Actions>> {
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

  if (userRunStepOptions.artifacts.length === 0) {
    ;() =>
      of<Actions>(
        ...artifactsEventsAbort({
          startStepMs,
          artifacts: userRunStepOptions.artifacts,
          step: userRunStepOptions.currentStepInfo,
          status: Status.skippedAsPassed,
        }),
        {
          type: ExecutionActionTypes.step,
          payload: {
            step: userRunStepOptions.currentStepInfo,
            stepResult: {
              durationMs: Date.now() - startStepMs,
              executionStatus: ExecutionStatus.aborted,
              status: Status.skippedAsPassed,
              errors: [],
              notes: [],
            },
          },
        },
      )
  }

  // each step needs to have an internal state because I can't count on
  // `userRunStepOptions.stepsResultOfArtifactsByStep[userRunStepOptions.curentStep.index]`
  // to be updated at all
  const artifactResultsOnCurrentStep: ChangeArtifactStatusAction[] = userRunStepOptions.artifacts.map(artifact => ({
    type: ExecutionActionTypes.artifactStep,
    payload: {
      artifact,
      step: userRunStepOptions.currentStepInfo,
      artifactStepResult: {
        executionStatus: ExecutionStatus.scheduled,
      },
    },
  }))

  const didArtifactRunConstain = userRunStepOptions.artifacts.map(() => false)

  let didSendStepRunning = false

  const areAllArtifactsFinished = (): boolean =>
    artifactResultsOnCurrentStep.every(a =>
      [ExecutionStatus.aborted, ExecutionStatus.done].includes(a.payload.artifactStepResult.executionStatus),
    )

  return (action, getState) =>
    new Observable<Actions>(observer => {
      if (action.type !== ExecutionActionTypes.artifactStep) {
        observer.complete()
        return
      }

      if (!waitUntilArtifactParentsFinishedParentSteps) {
        observer.next(action)
        observer.complete()
        return
      }

      const artifactParentsFinishedParentStep = areArtifactParentsFinishedParentSteps({
        artifactIndex: action.payload.artifact.index,
        artifacts: userRunStepOptions.artifacts,
        stepIndex: userRunStepOptions.currentStepInfo.index,
        stepsResultOfArtifactsByStep: getState().stepsResultOfArtifactsByStep,
      })

      if (artifactParentsFinishedParentStep) {
        observer.next(action)
      }

      for (const childIndex of action.payload.artifact.childrenIndexes) {
        const artifactParentsFinishedParentStep = areArtifactParentsFinishedParentSteps({
          artifactIndex: childIndex,
          artifacts: userRunStepOptions.artifacts,
          stepIndex: userRunStepOptions.currentStepInfo.index,
          stepsResultOfArtifactsByStep: getState().stepsResultOfArtifactsByStep,
        })
        const childResult = getState().stepsResultOfArtifactsByStep[userRunStepOptions.currentStepInfo.index].data
          .artifactsResult[childIndex].data.artifactStepResult
        if (artifactParentsFinishedParentStep && childResult.executionStatus === ExecutionStatus.scheduled) {
          observer.next({
            type: ExecutionActionTypes.artifactStep,
            payload: {
              step: userRunStepOptions.currentStepInfo,
              artifact: userRunStepOptions.artifacts[childIndex],
              artifactStepResult: childResult,
            },
          })
        }
      }
      observer.complete()
    }).pipe(
      mergeMap<Actions, Observable<Actions>>(
        action =>
          new Observable<Actions>(observer => {
            Promise.resolve().then(async () => {
              if (action.type !== ExecutionActionTypes.artifactStep) {
                observer.complete()
                return
              }
              const artifactExecutionStatus =
                artifactResultsOnCurrentStep[action.payload.artifact.index].payload.artifactStepResult.executionStatus
              const artifactRunConstain = didArtifactRunConstain[action.payload.artifact.index]
              const recursiveParentStepsFinishedOnArtifact = areRecursiveParentStepsFinishedOnArtifact({
                artifactIndex: action.payload.artifact.index,
                steps: userRunStepOptions.steps,
                stepIndex: userRunStepOptions.currentStepInfo.index,
                stepsResultOfArtifactsByArtifact: getState().stepsResultOfArtifactsByArtifact,
              })
              if (
                artifactExecutionStatus === ExecutionStatus.scheduled &&
                !artifactRunConstain && // prevent duplicate concurrent entries to this function (for the same artifact)
                recursiveParentStepsFinishedOnArtifact
              ) {
                didArtifactRunConstain[action.payload.artifact.index] = true
                const artifactConstrainsResult: CombinedConstrainResult = await runConstrains({
                  ...userRunStepOptions,
                  constrains: artifactConstrains.map(c => c(action.payload.artifact)),
                  artifactName: action.payload.artifact.data.artifact.packageJson.name,
                  logPrefix: `artifact-constrain`,
                  getState,
                })

                if (artifactConstrainsResult.combinedResultType === ConstrainResultType.shouldSkip) {
                  const e: ChangeArtifactStatusAction = {
                    type: ExecutionActionTypes.artifactStep,
                    payload: {
                      artifact: action.payload.artifact,
                      step: userRunStepOptions.currentStepInfo,
                      artifactStepResult: {
                        durationMs: Date.now() - startStepMs,
                        ...artifactConstrainsResult.combinedResult,
                      },
                    },
                  }
                  artifactResultsOnCurrentStep[action.payload.artifact.index] = e
                  observer.next(e)

                  const isStepAborted = artifactResultsOnCurrentStep.every(
                    a => a.payload.artifactStepResult.executionStatus === ExecutionStatus.aborted,
                  )
                  if (isStepAborted) {
                    const status = calculateCombinedStatusOfCurrentStep(artifactResultsOnCurrentStep)
                    if (status === Status.failed || status === Status.passed) {
                      throw new Error(`we can't be here8`)
                    }
                    observer.next({
                      type: ExecutionActionTypes.step,
                      payload: {
                        step: userRunStepOptions.currentStepInfo,
                        stepResult: {
                          durationMs: Date.now() - startStepMs,
                          executionStatus: ExecutionStatus.aborted,
                          status,
                          errors: [],
                          notes: [],
                        },
                      },
                    })
                  } else {
                    const didStepDone = artifactResultsOnCurrentStep.every(
                      a =>
                        a.payload.artifactStepResult.executionStatus === ExecutionStatus.aborted ||
                        a.payload.artifactStepResult.executionStatus === ExecutionStatus.done,
                    )
                    if (didStepDone) {
                      const status = calculateCombinedStatusOfCurrentStep(artifactResultsOnCurrentStep)
                      if (status === Status.skippedAsFailed || status === Status.skippedAsPassed) {
                        throw new Error(`we can't be here8`)
                      }
                      observer.next({
                        type: ExecutionActionTypes.step,
                        payload: {
                          step: userRunStepOptions.currentStepInfo,
                          stepResult: {
                            durationMs: Date.now() - startStepMs,
                            executionStatus: ExecutionStatus.done,
                            status,
                            errors: [],
                            notes: [],
                          },
                        },
                      })
                    }
                  }
                  return
                }

                if (!didSendStepRunning) {
                  didSendStepRunning = true
                  observer.next({
                    type: ExecutionActionTypes.step,
                    payload: {
                      step: userRunStepOptions.currentStepInfo,
                      stepResult: {
                        executionStatus: ExecutionStatus.running,
                      },
                    },
                  })
                }

                const eventRunning: ChangeArtifactStatusAction = {
                  type: ExecutionActionTypes.artifactStep,
                  payload: {
                    artifact: action.payload.artifact,
                    step: userRunStepOptions.currentStepInfo,
                    artifactStepResult: {
                      executionStatus: ExecutionStatus.running,
                    },
                  },
                }
                observer.next(eventRunning)
                artifactResultsOnCurrentStep[action.payload.artifact.index] = eventRunning

                await beforeAllQueue.push()

                const newEvent = await onArtifact({ artifact: action.payload.artifact }).then<
                  ChangeArtifactStatusAction,
                  ChangeArtifactStatusAction
                >(
                  r =>
                    r
                      ? {
                          type: ExecutionActionTypes.artifactStep,
                          payload: {
                            artifact: action.payload.artifact,
                            step: userRunStepOptions.currentStepInfo,
                            artifactStepResult: {
                              durationMs: Date.now() - startStepMs,
                              errors: [],
                              notes: [],
                              ...r,
                            },
                          },
                        }
                      : artifactsEventsDone({
                          artifacts: userRunStepOptions.artifacts,
                          startStepMs: userRunStepOptions.startStepMs,
                          step: userRunStepOptions.currentStepInfo,
                          status: Status.passed,
                        })[action.payload.artifact.index],
                  error => ({
                    type: ExecutionActionTypes.artifactStep,
                    payload: {
                      artifact: action.payload.artifact,
                      step: userRunStepOptions.currentStepInfo,
                      artifactStepResult: {
                        durationMs: Date.now() - startStepMs,
                        executionStatus: ExecutionStatus.done,
                        status: Status.failed,
                        errors: [serializeError(error)],
                        notes: [],
                      },
                    },
                  }),
                )

                observer.next(newEvent)
                artifactResultsOnCurrentStep[action.payload.artifact.index] = newEvent

                if (areAllArtifactsFinished()) {
                  await afterAllQueue.push()

                  const isStepAborted = artifactResultsOnCurrentStep.every(
                    a => a.payload.artifactStepResult.executionStatus === ExecutionStatus.aborted,
                  )
                  if (isStepAborted) {
                    const status = calculateCombinedStatusOfCurrentStep(artifactResultsOnCurrentStep)
                    if (status === Status.passed) {
                      throw new Error(`we can't be here9`)
                    }
                    observer.next({
                      type: ExecutionActionTypes.step,
                      payload: {
                        step: userRunStepOptions.currentStepInfo,
                        stepResult: {
                          durationMs: Date.now() - startStepMs,
                          executionStatus: ExecutionStatus.aborted,
                          status,
                          errors: [],
                          notes: [],
                        },
                      },
                    })
                    return
                  } else {
                    const status = calculateCombinedStatusOfCurrentStep(artifactResultsOnCurrentStep)
                    if (status === Status.skippedAsFailed || status === Status.skippedAsPassed) {
                      throw new Error(`we can't be here10`)
                    }
                    observer.next({
                      type: ExecutionActionTypes.step,
                      payload: {
                        step: userRunStepOptions.currentStepInfo,
                        stepResult: {
                          durationMs: Date.now() - startStepMs,
                          executionStatus: ExecutionStatus.done,
                          status,
                          errors: [],
                          notes: [],
                        },
                      },
                    })
                  }
                }
              }
              observer.complete()
            })
          }),
      ),
    )
}
