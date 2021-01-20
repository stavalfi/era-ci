import { ExecutionStatus, lastValueFrom } from '@era-ci/utils'
import { applyMiddleware, createStore, Dispatch, Middleware } from 'redux'
import { merge, Subject } from 'rxjs'
import { concatMap, defaultIfEmpty, tap } from 'rxjs/operators'
import { TaskQueueBase } from '../create-task-queue'
import { Actions, ExecutionActionTypes } from './actions'
import { createReducer } from './reducer'
import { State } from './state'
import { Options } from './types'

export { Actions, ChangeArtifactStatusAction, ChangeStepStatusAction } from './actions'
export { getInitialState } from './reducer'
export { State } from './state'

function findTaskQueue(options: Options & { currentStepIndex: number }): TaskQueueBase<any, any> {
  const taskQueue = options.taskQueues.find(
    t => t instanceof options.stepsToRun[options.currentStepIndex].data.taskQueueClass,
  )

  if (!taskQueue) {
    throw new Error(
      `can't find task-queue: "${options.stepsToRun[options.currentStepIndex].data.taskQueueClass.name}" for step: "${
        options.stepsToRun[options.currentStepIndex].data.stepInfo.displayName
      }" needs. did you forgot to declare the task-queue in the configuration file?`,
    )
  }

  return taskQueue
}

export async function runAllSteps(options: Options): Promise<State> {
  const subject = new Subject<Actions>()

  const middleware: Middleware<{}, State> = store => (next: Dispatch<Actions>) => {
    if (store.getState().flowFinished) {
      subject.complete()
    }
    return (action: Actions) => {
      const result = next(action)
      subject.next(action)
      if (store.getState().flowFinished) {
        subject.complete()
      }
      return result
    }
  }

  const store = createStore(createReducer(options), applyMiddleware(middleware))

  const onActionArray = await Promise.all(
    options.steps.map(async s => {
      const taskQueue = findTaskQueue({ ...options, currentStepIndex: s.index })
      const onAction = await options.stepsToRun[s.index].data.runStep(
        {
          ...options,
          taskQueue,
          currentStepInfo: options.steps[s.index],
        },
        store.getState.bind(store),
      )
      return onAction
    }),
  )

  const flowFinishedPromise = lastValueFrom(
    subject.pipe(
      concatMap(action => merge(...onActionArray.map(onAction => onAction(action, store.getState)))),
      tap(store.dispatch),
      defaultIfEmpty(),
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

  // // when there are no steps, we need to exit manually:
  // if (store.getState().flowFinished) {
  //   return store.getState()
  // }
}
