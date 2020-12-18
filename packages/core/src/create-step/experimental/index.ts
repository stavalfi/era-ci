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
import { artifactsEventsDone, artifactsEventsRunning, stepEventRunning } from './utils'

async function runStep<TaskQueue extends TaskQueueBase<unknown>, StepConfigurations>({
  allStepsEventsRecorded$,
  startStepMs,
  userRunStepOptions,
  run,
}: {
  allStepsEventsRecorded$: Observable<StepOutputEvents[StepOutputEventType]>
  startStepMs: number
  run: RunStepExperimental<TaskQueue, StepConfigurations>
  userRunStepOptions: UserRunStepOptions<TaskQueue, StepConfigurations>
}): Promise<Observable<StepOutputEvents[StepOutputEventType]>> {
  const prepareResult = run(userRunStepOptions) || { stepLogic: () => Promise.resolve() }

  const { globalConstrains = [], ...prepareResultOptions } = prepareResult

  const globalConstrainsResult = await runConstrains({
    ...userRunStepOptions,
    constrains: globalConstrains,
  })

  if (globalConstrainsResult.combinedResultType === ConstrainResultType.shouldSkip) {
    const events: (
      | StepOutputEvents[StepOutputEventType.artifactStep]
      | StepOutputEvents[StepOutputEventType.step]
    )[] = [
      stepEventRunning({ step: userRunStepOptions.currentStepInfo }),
      ...artifactsEventsRunning({ step: userRunStepOptions.currentStepInfo, artifacts: userRunStepOptions.artifacts }),
      ...artifactsEventsDone({
        step: userRunStepOptions.currentStepInfo,
        artifacts: userRunStepOptions.artifacts,
        startStepMs: userRunStepOptions.startStepMs,
      }),
      {
        type: StepOutputEventType.step,
        step: userRunStepOptions.currentStepInfo,
        stepResult: {
          durationMs: Date.now() - startStepMs,
          ...globalConstrainsResult.combinedResult,
        },
      },
    ]
    return from(events)
  }

  if ('stepLogic' in prepareResultOptions) {
    return runStepFunctions({
      allStepsEventsRecorded$,
      startStepMs: userRunStepOptions.startStepMs,
      userRunStepOptions,
      ...prepareResultOptions,
    })
  } else {
    return runArtifactFunctions({
      allStepsEventsRecorded$,
      startStepMs: userRunStepOptions.startStepMs,
      userRunStepOptions,
      ...prepareResultOptions,
    })
  }
}

export function createStepExperimental<
  TaskQueue extends TaskQueueBase<unknown>,
  StepConfigurations = void,
  NormalizedStepConfigurations = StepConfigurations
>(createStepOptions: CreateStepOptionsExperimental<TaskQueue, StepConfigurations, NormalizedStepConfigurations>) {
  return (stepConfigurations: StepConfigurations): StepExperimental<TaskQueue> => {
    return {
      stepName: createStepOptions.stepName,
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

          return runStep({
            run: createStepOptions.run,
            startStepMs,
            allStepsEventsRecorded$,
            userRunStepOptions,
          })
        }).pipe(concatMap(identity))
      },
    }
  }
}
