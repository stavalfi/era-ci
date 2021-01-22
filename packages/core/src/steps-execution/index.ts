import { ExecutionStatus, lastValueFrom } from '@era-ci/utils'
import _ from 'lodash'
import { applyMiddleware, createStore, Dispatch, Middleware } from 'redux'
import { merge, Subject } from 'rxjs'
import { bufferTime, concatMap, map, mergeMap, tap } from 'rxjs/operators'
import { Actions, ExecutionActionTypes } from './actions'
import { createReducer } from './reducer'
import { State } from './state'
import { Options } from './types'
import { buildRedisCommands, findTaskQueue, logAction } from './utils'

export { Actions, ChangeArtifactStatusAction, ChangeStepStatusAction } from './actions'
export { State } from './state'

export async function runAllSteps(options: Options): Promise<State> {
  const actions$ = new Subject<Actions>()

  const middleware: Middleware<{}, State> = store => (next: Dispatch<Actions>) => {
    return (action: Actions) => {
      const oldState = store.getState()
      next(action)
      const newState = store.getState()
      if (oldState !== newState) {
        actions$.next(action)
        if (store.getState().flowFinished) {
          actions$.complete()
        }
      }
    }
  }

  const store = createStore(createReducer(options), applyMiddleware(middleware))

  if (store.getState().flowFinished) {
    actions$.complete()
    return store.getState()
  }

  const onActionArray = await Promise.all(
    options.steps.map(async s => {
      const taskQueue = findTaskQueue({ ...options, currentStepIndex: s.index })
      const onAction = await options.stepsToRun[s.index].data.runStep(
        {
          ...options,
          taskQueue,
          currentStepInfo: options.steps[s.index],
        },
        store.getState,
      )
      return onAction
    }),
  )

  const flowFinishedPromise = lastValueFrom(
    merge(
      actions$.pipe(
        tap(action => logAction({ log: options.log, action })),
        map(action => buildRedisCommands({ ...options, action })),
        bufferTime(100),
        concatMap(redisCommands => options.redisClient.multi(_.flatten(redisCommands))),
      ),
      actions$.pipe(
        mergeMap(action => merge(...onActionArray.map(onAction => onAction(action, store.getState)))),
        tap(store.dispatch),
      ),
    ),
  )

  for (const step of store.getState().stepsResultOfArtifactsByStep) {
    store.dispatch({
      type: ExecutionActionTypes.step,
      payload: {
        type: ExecutionActionTypes.step,
        step: options.steps[step.index],
        stepResult: {
          executionStatus: ExecutionStatus.scheduled,
        },
      },
    })
    for (const artifact of step.data.artifactsResult) {
      store.dispatch({
        type: ExecutionActionTypes.artifactStep,
        payload: {
          type: ExecutionActionTypes.artifactStep,
          step: options.steps[step.index],
          artifact: options.artifacts[artifact.index],
          artifactStepResult: {
            executionStatus: ExecutionStatus.scheduled,
          },
        },
      })
    }
  }

  await flowFinishedPromise

  return store.getState()
}
