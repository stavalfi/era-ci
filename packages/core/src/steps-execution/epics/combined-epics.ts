import { ExecutionStatus, GitRepoInfo, StepOutputEventType, StepRedisEvent } from '@era-ci/utils'
import _ from 'lodash'
import { Epic } from 'redux-observable'
import { from, merge } from 'rxjs'
import { concatMap, filter, map, takeUntil, tap } from 'rxjs/operators'
import { deserializeError } from 'serialize-error'
import { Log, LogLevel } from '../../create-logger'
import { ImmutableCache } from '../../immutable-cache'
import { getEventsTopicName } from '../../utils'
import { Actions } from '../actions'
import { State } from '../state'
import { Options } from '../types'
import { createStepEpic } from './run-step'

export const createCombinedEpic = (options: Options): Epic<Actions, Actions, State> => (action$, state$, dep) =>
  merge(
    ...options.steps
      .map(s => createStepEpic({ ...options, currentStepInfo: s, getState: () => state$.value }))
      .map(runStepEpic => runStepEpic(action$, state$, dep)),
  ).pipe(
    tap(action => logAction({ log: options.log, action })),
    map(action => [{ action, redisCommands: buildRedisCommands({ ...options, action }) }]),
    filter(array => array.length > 0),
    concatMap(async array => {
      const commands = _.flatten(array.map(({ redisCommands }) => redisCommands))
      const results: Array<[Error | null, unknown]> = await options.redisClient.connection.multi(commands).exec()
      if (results.some(([error]) => error)) {
        throw results
      }
      return array.map(({ action }) => action)
    }),
    concatMap(actions => from(actions)),
  )

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
    options.action.type === StepOutputEventType.artifactStep &&
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
    options.action.type === StepOutputEventType.step &&
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
        event: options.action.payload,
      }),
    ),
  ])

  return redisCommands
}

const logAction = ({ log, action }: { log: Log; action: Actions }): void => {
  switch (action.payload.type) {
    case StepOutputEventType.step: {
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
    case StepOutputEventType.artifactStep: {
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
