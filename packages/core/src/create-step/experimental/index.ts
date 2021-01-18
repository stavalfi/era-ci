import { StepOutputEventType } from '@era-ci/utils'
import { ConnectableObservable, defer, from, identity, Observable } from 'rxjs'
import { concatMap, publishReplay } from 'rxjs/operators'
import { ConstrainResultType, runConstrains } from '../../create-constrain'
import { TaskQueueBase } from '../../create-task-queue'
import { Actions } from '../../steps-execution'
import { CreateStepOptionsExperimental, RunStepExperimental, StepExperimental, UserRunStepOptions } from '../types'
import { runArtifactFunctions } from './run-artifact-functions'
import { runStepFunctions } from './run-step-functions'
import { artifactsEventsAbort } from './utils'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function runStep<TaskQueue extends TaskQueueBase<any, any>, StepConfigurations>({
  allStepsEventsRecorded$,
  userRunStepOptions,
  run,
}: {
  allStepsEventsRecorded$: Observable<Actions>
  run: RunStepExperimental<TaskQueue, StepConfigurations>
  userRunStepOptions: UserRunStepOptions<TaskQueue, StepConfigurations>
}): Observable<Actions> {
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
        const events: Actions[] = [
          ...artifactsEventsAbort({
            step: userRunStepOptions.currentStepInfo,
            artifacts: userRunStepOptions.artifacts,
            startStepMs: userRunStepOptions.startStepMs,
            status: globalConstrainsResult.combinedResult.status,
          }),
          {
            type: StepOutputEventType.step,
            payload: {
              type: StepOutputEventType.step,
              step: userRunStepOptions.currentStepInfo,
              stepResult: {
                durationMs: Date.now() - userRunStepOptions.startStepMs,
                ...globalConstrainsResult.combinedResult,
              },
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TaskQueue extends TaskQueueBase<any, any>,
  StepConfigurations = void,
  NormalizedStepConfigurations = StepConfigurations
>(createStepOptions: CreateStepOptionsExperimental<TaskQueue, StepConfigurations, NormalizedStepConfigurations>) {
  return (stepConfigurations: StepConfigurations): StepExperimental<TaskQueue> => {
    return {
      stepName: createStepOptions.stepName,
      stepGroup: createStepOptions.stepGroup,
      taskQueueClass: createStepOptions.taskQueueClass,
      runStep: (runStepOptions, action$) => {
        const allStepsEventsRecorded$ = action$.pipe(publishReplay()) as ConnectableObservable<Actions>

        allStepsEventsRecorded$.connect()

        const log = runStepOptions.logger.createLog(runStepOptions.currentStepInfo.data.stepInfo.stepName)

        return defer(async () => {
          const startStepMs = Date.now()

          // @ts-ignore - we need to find a way to ensure that if NormalizedStepConfigurations is defined, also normalizeStepConfigurations is defined.
          const normalizedStepConfigurations: NormalizedStepConfigurations = createStepOptions.normalizeStepConfigurations
            ? await createStepOptions.normalizeStepConfigurations(stepConfigurations, runStepOptions)
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
