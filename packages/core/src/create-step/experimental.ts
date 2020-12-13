import { concatMapOnce, ExecutionStatus, Status } from '@tahini/utils'
import { concat, EMPTY, from, Observable, of, ReplaySubject } from 'rxjs'
import { concatMap, map, mergeMap, tap } from 'rxjs/operators'
import { serializeError } from 'serialize-error'
import { CombinedConstrainResult, ConstrainResultType, runConstrains } from '../create-constrain'
import { TaskQueueBase } from '../create-task-queue'
import {
  CreateStepOptionsExperimental,
  StepExperimental,
  StepOutputEvents,
  StepOutputEventType,
  UserRunStepOptions,
} from './types'

export function createStepExperimental<
  TaskQueue extends TaskQueueBase<unknown>,
  StepConfigurations = void,
  NormalizedStepConfigurations = StepConfigurations
>(createStepOptions: CreateStepOptionsExperimental<TaskQueue, StepConfigurations, NormalizedStepConfigurations>) {
  return (stepConfigurations: StepConfigurations): StepExperimental<TaskQueue> => ({
    stepName: createStepOptions.stepName,
    taskQueueClass: createStepOptions.taskQueueClass,
    runStep: async (runStepOptions, stepsEvents$) => {
      const startStepMs = Date.now()
      // @ts-ignore - we need to find a way to ensure that if NormalizedStepConfigurations is defined, also normalizeStepConfigurations is defined.
      const normalizedStepConfigurations: NormalizedStepConfigurations = createStepOptions.normalizeStepConfigurations
        ? await createStepOptions.normalizeStepConfigurations(stepConfigurations)
        : stepConfigurations

      const userRunStepOptions: UserRunStepOptions<TaskQueue, NormalizedStepConfigurations> = {
        ...runStepOptions,
        log: runStepOptions.logger.createLog(runStepOptions.currentStepInfo.data.stepInfo.stepName),
        startStepMs,
        stepConfigurations: normalizedStepConfigurations,
      }

      const prepareResult = await createStepOptions.run(userRunStepOptions)

      const artifactsEventsScheduled = (): StepOutputEvents[StepOutputEventType.artifactStep][] =>
        userRunStepOptions.artifacts.map<StepOutputEvents[StepOutputEventType.artifactStep]>(artifact => ({
          type: StepOutputEventType.artifactStep,
          artifact,
          artifactStepResult: {
            executionStatus: ExecutionStatus.scheduled,
          },
        }))

      const artifactsEventsAbortedAsFailed = (): StepOutputEvents[StepOutputEventType.artifactStep][] =>
        userRunStepOptions.artifacts.map<StepOutputEvents[StepOutputEventType.artifactStep]>(artifact => ({
          type: StepOutputEventType.artifactStep,
          artifact,
          artifactStepResult: {
            durationMs: Date.now() - startStepMs,
            executionStatus: ExecutionStatus.aborted,
            status: Status.skippedAsFailed,
            errors: [],
            notes: [],
          },
        }))

      const artifactsEventsDone = (): StepOutputEvents[StepOutputEventType.artifactStep][] =>
        userRunStepOptions.artifacts.map<StepOutputEvents[StepOutputEventType.artifactStep]>(artifact => ({
          type: StepOutputEventType.artifactStep,
          artifact,
          artifactStepResult: {
            durationMs: Date.now() - startStepMs,
            executionStatus: ExecutionStatus.done,
            status: Status.passed,
            errors: [],
            notes: [],
          },
        }))

      const stepEventDone = (): StepOutputEvents[StepOutputEventType.step] => ({
        type: StepOutputEventType.step,
        stepResult: {
          durationMs: Date.now() - startStepMs,
          executionStatus: ExecutionStatus.done,
          status: Status.passed,
          errors: [],
          notes: [],
        },
      })

      if (!prepareResult) {
        const events: (
          | StepOutputEvents[StepOutputEventType.artifactStep]
          | StepOutputEvents[StepOutputEventType.step]
        )[] = [...artifactsEventsScheduled(), ...artifactsEventsDone(), stepEventDone()]
        return from(events)
      }

      const { stepConstrains = [], ...prepareResultOptions } = prepareResult

      const stepConstrainsResult = await runConstrains({
        ...userRunStepOptions,
        constrains: stepConstrains,
      })

      if (stepConstrainsResult.combinedResultType === ConstrainResultType.shouldSkip) {
        const events: (
          | StepOutputEvents[StepOutputEventType.artifactStep]
          | StepOutputEvents[StepOutputEventType.step]
        )[] = [
          ...artifactsEventsScheduled(),
          ...artifactsEventsDone(),
          {
            type: StepOutputEventType.step,
            stepResult: {
              durationMs: Date.now() - startStepMs,
              ...stepConstrainsResult.combinedResult,
            },
          },
        ]
        return from(events)
      }

      if ('stepLogic' in prepareResultOptions) {
        const { stepLogic } = prepareResultOptions
        return concat<StepOutputEvents[StepOutputEventType]>(
          from([...artifactsEventsScheduled(), ...artifactsEventsAbortedAsFailed()]),
          (stepLogic ? stepLogic() : Promise.resolve()).then(
            r =>
              r
                ? {
                    type: StepOutputEventType.step,
                    stepResult: {
                      durationMs: Date.now() - startStepMs,
                      errors: [],
                      notes: [],
                      ...r,
                    },
                  }
                : stepEventDone(),
            error => ({
              type: StepOutputEventType.step,
              stepResult: {
                durationMs: Date.now() - startStepMs,
                executionStatus: ExecutionStatus.done,
                status: Status.failed,
                errors: [serializeError(error)],
                notes: [],
              },
            }),
          ),
        )
      }

      if (!('artifactConstrains' in prepareResultOptions)) {
        throw new Error(`we can't be here`)
      }

      const {
        artifactConstrains = [],
        onBeforeArtifacts = () => Promise.resolve(),
        onArtifact = () => Promise.resolve(),
        onAfterArtifacts = () => Promise.resolve(),
      } = prepareResultOptions

      const subject = new ReplaySubject<StepOutputEvents[StepOutputEventType]>()

      return stepsEvents$.pipe(
        // allow to continue only after parent-steps finished to process this package:
        mergeMap<StepOutputEvents[StepOutputEventType], Observable<StepOutputEvents[StepOutputEventType.artifactStep]>>(
          e => {
            if (e.type === StepOutputEventType.artifactStep) {
              const stepsOfArtifact =
                userRunStepOptions.stepsResultOfArtifactsByArtifact[e.artifact.index].data.stepsResult
              const parentSteps = userRunStepOptions.currentStepInfo.parentsIndexes
              if (
                parentSteps.every(
                  p =>
                    stepsOfArtifact[p].data.artifactStepResult.executionStatus === ExecutionStatus.aborted ||
                    stepsOfArtifact[p].data.artifactStepResult.executionStatus === ExecutionStatus.done,
                )
              ) {
                return of({
                  type: StepOutputEventType.artifactStep,
                  artifact: e.artifact,
                  artifactStepResult: {
                    executionStatus: ExecutionStatus.scheduled,
                  },
                })
              }
            }
            return EMPTY
          },
        ),
        tap(e => subject.next(e)),
        mergeMap<
          StepOutputEvents[StepOutputEventType.artifactStep],
          Promise<[StepOutputEvents[StepOutputEventType.artifactStep], CombinedConstrainResult]>
        >(async e => [
          e,
          await runConstrains({
            ...userRunStepOptions,
            constrains: artifactConstrains.map(c => c(e.artifact)),
          }),
        ]),
        map<
          [StepOutputEvents[StepOutputEventType.artifactStep], CombinedConstrainResult],
          StepOutputEvents[StepOutputEventType.artifactStep]
        >(([e, artifactConstrainsResult]) => {
          if (artifactConstrainsResult.combinedResultType === ConstrainResultType.shouldSkip) {
            return {
              type: StepOutputEventType.artifactStep,
              artifact: e.artifact,
              artifactStepResult: {
                durationMs: Date.now() - startStepMs,
                ...artifactConstrainsResult.combinedResult,
              },
            }
          } else {
            return {
              type: StepOutputEventType.artifactStep,
              artifact: e.artifact,
              artifactStepResult: {
                executionStatus: ExecutionStatus.running,
              },
            }
          }
        }),
        tap(e => subject.next(e)),
        concatMapOnce(
          e => e.artifactStepResult.executionStatus === ExecutionStatus.running,
          () => onBeforeArtifacts(),
        ),
        mergeMap<
          StepOutputEvents[StepOutputEventType.artifactStep],
          Promise<StepOutputEvents[StepOutputEventType.artifactStep]>
        >(e =>
          onArtifact({ artifact: e.artifact }).then<
            StepOutputEvents[StepOutputEventType.artifactStep],
            StepOutputEvents[StepOutputEventType.artifactStep]
          >(
            r =>
              r
                ? {
                    type: StepOutputEventType.artifactStep,
                    artifact: e.artifact,
                    artifactStepResult: {
                      durationMs: Date.now() - startStepMs,
                      errors: [],
                      notes: [],
                      ...r,
                    },
                  }
                : artifactsEventsDone()[e.artifact.index],
            error => ({
              type: StepOutputEventType.artifactStep,
              artifact: e.artifact,
              artifactStepResult: {
                durationMs: Date.now() - startStepMs,
                executionStatus: ExecutionStatus.done,
                status: Status.failed,
                errors: [serializeError(error)],
                notes: [],
              },
            }),
          ),
        ),
        tap(e => subject.next(e)),
        // concatMap(e => {
        //   // check if the step is done/aborted, and then send a stepDone event with the correct status
        //   return EMPTY
        // }),
        concatMap(() => subject),
      )
    },
  })
}
