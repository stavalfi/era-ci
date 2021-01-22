import { ExecutionStatus, GitRepoInfo, lastValueFrom } from '@era-ci/utils'
import _ from 'lodash'
import { applyMiddleware, createStore, Dispatch, Middleware } from 'redux'
import { merge, Subject } from 'rxjs'
import { concatMap, tap } from 'rxjs/operators'
import { deserializeError } from 'serialize-error'
import { Log, LogLevel } from '../create-logger'
import { TaskQueueBase } from '../create-task-queue'
import { ImmutableCache } from '../immutable-cache'
import { StepRedisEvent } from '../types'
import { getEventsTopicName } from '../utils'
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
  const actions$ = new Subject<Actions>()

  const middleware: Middleware<{}, State> = store => (next: Dispatch<Actions>) => {
    return (action: Actions) => {
      next(action)
      actions$.next(action)
      if (store.getState().flowFinished) {
        actions$.complete()
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
        concatMap(action => options.redisClient.multi(buildRedisCommands({ ...options, action }))),
      ),
      actions$.pipe(
        concatMap(action => merge(...onActionArray.map(onAction => onAction(action, store.getState)))),
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

function buildRedisCommands(options: {
  gitRepoInfo: GitRepoInfo
  flowId: string
  repoHash: string
  startFlowMs: number
  immutableCache: ImmutableCache
  processEnv: NodeJS.ProcessEnv
  action: Actions
}): string[][] {
  const redisCommands: string[][] = []
  if (
    options.action.type === ExecutionActionTypes.artifactStep &&
    options.action.payload.artifactStepResult.executionStatus === ExecutionStatus.done
  ) {
    redisCommands.push(
      options.immutableCache.step.setArtifactStepResultResipe({
        stepId: options.action.payload.step.data.stepInfo.stepId,
        artifactHash: options.action.payload.artifact.data.artifact.packageHash,
        artifactStepResult: options.action.payload.artifactStepResult,
      }),
    )
  }
  if (
    options.action.type === ExecutionActionTypes.step &&
    options.action.payload.stepResult.executionStatus === ExecutionStatus.done
  ) {
    redisCommands.push(
      options.immutableCache.step.setStepResultResipe({
        stepId: options.action.payload.step.data.stepInfo.stepId,
        stepResult: options.action.payload.stepResult,
      }),
    )
  }
  redisCommands.push([
    'publish',
    getEventsTopicName(options.processEnv),
    JSON.stringify(
      _.identity<StepRedisEvent>({
        flowId: options.flowId,
        gitCommit: options.gitRepoInfo.commit,
        repoName: options.gitRepoInfo.repoName,
        repoHash: options.repoHash,
        startFlowMs: options.startFlowMs,
        event: options.action,
        eventTs: Date.now(),
      }),
    ),
  ])

  return redisCommands
}

const logAction = ({ log, action }: { log: Log; action: Actions }): void => {
  switch (action.type) {
    case ExecutionActionTypes.step: {
      const base = `step: "${action.payload.step.data.stepInfo.displayName}" - execution-status: "${action.payload.stepResult.executionStatus}"`
      switch (action.payload.stepResult.executionStatus) {
        case ExecutionStatus.scheduled:
        case ExecutionStatus.running:
          log.debug(base)
          break
        case ExecutionStatus.aborted:
        case ExecutionStatus.done: {
          const s = `${base}, status: "${action.payload.stepResult.status}"`
          if (action.payload.stepResult.errors.length > 0) {
            log.debug(s)
            if (log.logLevel === LogLevel.debug || log.logLevel === LogLevel.trace) {
              action.payload.stepResult.errors.map(deserializeError).forEach(error => log.error('', error))
            }
          } else {
            log.debug(s)
          }
          break
        }
      }
      break
    }
    case ExecutionActionTypes.artifactStep: {
      const base = `step: "${action.payload.step.data.stepInfo.displayName}", artifact: "${action.payload.artifact.data.artifact.packageJson.name}" - execution-status: "${action.payload.artifactStepResult.executionStatus}"`
      switch (action.payload.artifactStepResult.executionStatus) {
        case ExecutionStatus.scheduled:
        case ExecutionStatus.running:
          log.debug(base)
          break
        case ExecutionStatus.aborted:
        case ExecutionStatus.done: {
          const s = `${base}, status: "${action.payload.artifactStepResult.status}"`
          if (action.payload.artifactStepResult.errors.length > 0) {
            log.debug(s)
            if (log.logLevel === LogLevel.debug || log.logLevel === LogLevel.trace) {
              action.payload.artifactStepResult.errors.map(deserializeError).forEach(error => log.error('', error))
            }
          } else {
            log.debug(s)
          }
          break
        }
      }
      break
    }
  }
}
