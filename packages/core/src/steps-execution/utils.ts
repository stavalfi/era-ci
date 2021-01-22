import { ExecutionStatus, GitRepoInfo } from '@era-ci/utils'
import _ from 'lodash'
import { deserializeError } from 'serialize-error'
import { Log, LogLevel } from '../create-logger'
import { TaskQueueBase } from '../create-task-queue'
import { ImmutableCache } from '../immutable-cache'
import { StepRedisEvent } from '../types'
import { getEventsTopicName } from '../utils'
import { Actions, ExecutionActionTypes } from './actions'
import { Options } from './types'

export function findTaskQueue(options: Options & { currentStepIndex: number }): TaskQueueBase<any, any> {
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

export function buildRedisCommands(options: {
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

export const logAction = ({ log, action, prefix }: { log: Log; action: Actions; prefix?: string }): void => {
  switch (action.type) {
    case ExecutionActionTypes.step: {
      const base = `${prefix ? `${prefix} - ` : ''}step: "${
        action.payload.step.data.stepInfo.displayName
      }" - execution-status: "${action.payload.stepResult.executionStatus}"`
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
