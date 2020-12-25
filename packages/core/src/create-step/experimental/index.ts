import { ConnectableObservable, defer, from, identity, Observable } from 'rxjs'
import { concatMap, publishReplay } from 'rxjs/operators'
import { ConstrainResultType, runConstrains } from '../../create-constrain'
import { TaskQueueBase } from '../../create-task-queue'
import {
  CreateStepOptionsExperimental,
  RunStepExperimental,
  StepExperimental,
  StepOutputEvents,
  StepOutputEventType,
  UserRunStepOptions,
} from '../types'
import { runArtifactFunctions } from './run-artifact-functions'
import { runStepFunctions } from './run-step-functions'
import { artifactsEventsAbort } from './utils'

function runStep<TaskQueue extends TaskQueueBase<unknown>, StepConfigurations>({
  allStepsEventsRecorded$,
  userRunStepOptions,
  run,
}: {
  allStepsEventsRecorded$: Observable<StepOutputEvents[StepOutputEventType]>
  run: RunStepExperimental<TaskQueue, StepConfigurations>
  userRunStepOptions: UserRunStepOptions<TaskQueue, StepConfigurations>
}): Observable<StepOutputEvents[StepOutputEventType]> {
  return defer(async () => {
    const prepareResult = run(userRunStepOptions) || { stepLogic: () => Promise.resolve() }

    const { globalConstrains = [] } = prepareResult

    const globalConstrainsResult = await runConstrains({
      ...userRunStepOptions,
      constrains: globalConstrains,
      log: userRunStepOptions.log,
      logPrefix: `global-constrain`,
    })

    return {
      prepareResult,
      globalConstrainsResult,
    }
  }).pipe(
    concatMap(({ globalConstrainsResult, prepareResult }) => {
      if (globalConstrainsResult.combinedResultType === ConstrainResultType.shouldSkip) {
        const events: (
          | StepOutputEvents[StepOutputEventType.artifactStep]
          | StepOutputEvents[StepOutputEventType.step]
        )[] = [
          ...artifactsEventsAbort({
            step: userRunStepOptions.currentStepInfo,
            artifacts: userRunStepOptions.artifacts,
            startStepMs: userRunStepOptions.startStepMs,
            status: globalConstrainsResult.combinedResult.status,
          }),
          {
            type: StepOutputEventType.step,
            step: userRunStepOptions.currentStepInfo,
            stepResult: {
              durationMs: Date.now() - userRunStepOptions.startStepMs,
              ...globalConstrainsResult.combinedResult,
            },
          },
        ]
        return from(events)
      }

      if ('onArtifact' in prepareResult) {
        return runArtifactFunctions({
          allStepsEventsRecorded$,
          startStepMs: userRunStepOptions.startStepMs,
          userRunStepOptions,
          ...prepareResult,
        })
      } else {
        return from(
          runStepFunctions({
            allStepsEventsRecorded$,
            startStepMs: userRunStepOptions.startStepMs,
            userRunStepOptions,
            ...prepareResult,
          }),
        ).pipe(concatMap(identity))
      }
    }),
  )
}

export function createStepExperimental<
  TaskQueue extends TaskQueueBase<unknown>,
  StepConfigurations = void,
  NormalizedStepConfigurations = StepConfigurations
>(createStepOptions: CreateStepOptionsExperimental<TaskQueue, StepConfigurations, NormalizedStepConfigurations>) {
  return (stepConfigurations: StepConfigurations): StepExperimental<TaskQueue> => {
    return {
      stepName: createStepOptions.stepName,
      stepGroup: createStepOptions.stepGroup,
      taskQueueClass: createStepOptions.taskQueueClass,
      runStep: (runStepOptions, stepsEvents$) => {
        const allStepsEventsRecorded$ = stepsEvents$.pipe(publishReplay()) as ConnectableObservable<
          StepOutputEvents[StepOutputEventType]
        >

        allStepsEventsRecorded$.connect()

        const log = runStepOptions.logger.createLog(runStepOptions.currentStepInfo.data.stepInfo.stepName)

        return defer(async () => {
          const startStepMs = Date.now()

          // @ts-ignore - we need to find a way to ensure that if NormalizedStepConfigurations is defined, also normalizeStepConfigurations is defined.
          const normalizedStepConfigurations: NormalizedStepConfigurations = createStepOptions.normalizeStepConfigurations
            ? await createStepOptions.normalizeStepConfigurations(stepConfigurations)
            : stepConfigurations

          const userRunStepOptions: UserRunStepOptions<TaskQueue, NormalizedStepConfigurations> = {
            ...runStepOptions,
            log,
            startStepMs,
            stepConfigurations: normalizedStepConfigurations,
          }
          return userRunStepOptions
        }).pipe(
          concatMap(userRunStepOptions =>
            runStep({
              run: createStepOptions.run,
              allStepsEventsRecorded$,
              userRunStepOptions,
            }),
          ),
        )
      },
    }
  }
}
