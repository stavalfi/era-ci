import { ExecutionStatus, lastValueFrom } from '@era-ci/utils'
import _ from 'lodash'
import { applyMiddleware, createStore, Dispatch, Middleware } from 'redux'
import { merge, Observable, Subject } from 'rxjs'
import { bufferTime, map, mergeMap, tap } from 'rxjs/operators'
import { Actions, ExecutionActionTypes } from './actions'
import { createReducer } from './reducer'
import { State } from './state'
import { Options } from './types'
import { buildRedisCommands, findTaskQueue, logAction } from './utils'

export { Actions, ChangeArtifactStatusAction, ChangeStepStatusAction, ExecutionActionTypes } from './actions'
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

  if (options.steps.length > 0 && options.artifacts.length > 0) {
    options.log.info(`start to execute steps...`)
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

  const sendRedisCommands = () => (source: Observable<Actions>): Observable<Actions> =>
    source.pipe(
      map(action => ({ action, redisCommands: buildRedisCommands({ ...options, action }) })),
      bufferTime(100),
      mergeMap(async array => {
        await options.redisClient.multi(_.flatten(array.map(({ redisCommands }) => redisCommands)))
        return array.map(({ action }) => action)
      }),
      mergeMap(actions => actions),
    )

  const flowFinishedPromise = lastValueFrom(
    actions$.pipe(
      tap(action => logAction({ log: options.log, action })),
      sendRedisCommands(),
      mergeMap(action => merge(...onActionArray.map(onAction => onAction(action, store.getState)))),
      tap(store.dispatch),
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
