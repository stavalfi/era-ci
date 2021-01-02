import { Artifact, ExecutionStatus, GitRepoInfo, Graph, PackageJson } from '@era-ci/utils'
import { merge, Observable, Subject } from 'rxjs'
import { filter, mergeMap, tap } from 'rxjs/operators'
import { deserializeError } from 'serialize-error'
import { Log, Logger, LogLevel } from './create-logger'
import {
  StepExperimental,
  StepInfo,
  StepOutputEvents,
  StepOutputEventType,
  toStepsResultOfArtifactsByArtifact,
} from './create-step'
import { TaskQueueBase, TaskQueueOptions } from './create-task-queue'
import { ImmutableCache } from './immutable-cache'
import { GetState, State } from './types'

type Options = {
  log: Log
  gitRepoInfo: GitRepoInfo
  rootPackageJson: PackageJson
  taskQueues: Array<TaskQueueBase<unknown>>
  repoPath: string
  steps: Graph<{ stepInfo: StepInfo }>
  stepsToRun: Graph<{
    stepInfo: StepInfo
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    taskQueueClass: { new (options: TaskQueueOptions<any>): any }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runStep: StepExperimental<any>['runStep']
  }>
  flowId: string
  repoHash: string
  startFlowMs: number
  immutableCache: ImmutableCache
  logger: Logger
  artifacts: Graph<{ artifact: Artifact }>
  processEnv: NodeJS.ProcessEnv
}

function runStep(
  options: {
    stepIndex: number
    allStepsEvents$: Observable<StepOutputEvents[StepOutputEventType]>
  } & Options & { getState: GetState },
): Observable<StepOutputEvents[StepOutputEventType]> {
  const taskQueue = options.taskQueues.find(t => t instanceof options.stepsToRun[options.stepIndex].data.taskQueueClass)
  if (!taskQueue) {
    throw new Error(
      `can't find task-queue: "${options.stepsToRun[options.stepIndex].data.taskQueueClass.name}" for step: "${
        options.stepsToRun[options.stepIndex].data.stepInfo.displayName
      }" needs. did you forgot to declare the task-queue in the configuration file?`,
    )
  }
  function isRecursiveParent(stepIndex: number, possibleParentIndex: number): boolean {
    return (
      options.steps[stepIndex].parentsIndexes.includes(possibleParentIndex) ||
      options.steps[stepIndex].parentsIndexes.some(p => isRecursiveParent(p, possibleParentIndex))
    )
  }

  return options.stepsToRun[options.stepIndex].data.runStep(
    { ...options, taskQueue, currentStepInfo: options.steps[options.stepIndex] },
    options.allStepsEvents$.pipe(
      filter(
        e =>
          // only allow events from recuresive-parent-steps or scheduled-events from current step.
          isRecursiveParent(options.stepIndex, e.step.index) ||
          (e.step.index === options.stepIndex &&
            (e.type === StepOutputEventType.step
              ? e.stepResult.executionStatus === ExecutionStatus.scheduled
              : e.artifactStepResult.executionStatus === ExecutionStatus.scheduled)),
      ),
    ),
  )
}

export function runAllSteps(options: Options, state: Omit<State, 'getResult' | 'getReturnValue'>) {
  options.log.verbose(`starting to execute steps`)

  const getResult: State['getResult'] = opt => {
    const artifactIndex = options.artifacts.findIndex(a => a.data.artifact.packageJson.name === opt.artifactName)
    if (artifactIndex < 0) {
      throw new Error(`artifactName: "${opt.artifactName}" not found`)
    }

    const stepIndex = options.steps.findIndex(a =>
      'stepId' in opt ? a.data.stepInfo.stepId === opt.stepId : a.data.stepInfo.stepGroup === opt.stepGroup,
    )
    if (stepIndex < 0) {
      if ('stepId' in opt) {
        throw new Error(`'step-id': "${opt.stepId}" not found`)
      } else {
        throw new Error(`'step-group': "${opt.stepGroup}" not found`)
      }
    }

    return state.stepsResultOfArtifactsByStep[stepIndex].data.artifactsResult[artifactIndex].data.artifactStepResult
  }

  const getReturnValue: State['getReturnValue'] = opt => {
    const artifactStepResult = getResult(opt)
    if (
      artifactStepResult.executionStatus !== ExecutionStatus.aborted &&
      artifactStepResult.executionStatus !== ExecutionStatus.done
    ) {
      if ('stepId' in opt) {
        throw new Error(`'step-id': "${opt.stepId}" not done yet so we can't get it's return value`)
      } else {
        throw new Error(`'step-group': "${opt.stepGroup}" not done yet so we can't get it's return value`)
      }
    }
    const result = opt.mapper(artifactStepResult.returnValue)
    if (result === undefined) {
      throw new Error(`invalid return-value from step: "undefined"`)
    }
    return result
  }

  const fullState: State = {
    ...state,
    getResult,
    getReturnValue,
  }

  const allStepsEvents$ = new Subject<StepOutputEvents[StepOutputEventType]>()

  const logEvent = (e: StepOutputEvents[StepOutputEventType]) => {
    switch (e.type) {
      case StepOutputEventType.step: {
        const base = `step: "${e.step.data.stepInfo.displayName}" - execution-status: "${e.stepResult.executionStatus}"`
        switch (e.stepResult.executionStatus) {
          case ExecutionStatus.scheduled:
          case ExecutionStatus.running:
            options.log.debug(base)
            break
          case ExecutionStatus.aborted:
          case ExecutionStatus.done: {
            const s = `${base}, status: "${e.stepResult.status}"`
            if (e.stepResult.errors.length > 0) {
              options.log.debug(s)
              if (options.log.logLevel === LogLevel.debug || options.log.logLevel === LogLevel.trace) {
                e.stepResult.errors.map(deserializeError).forEach(error => options.log.error('', error))
              }
            } else {
              options.log.debug(s)
            }
            break
          }
        }
        break
      }
      case StepOutputEventType.artifactStep: {
        const base = `step: "${e.step.data.stepInfo.displayName}", artifact: "${e.artifact.data.artifact.packageJson.name}" - execution-status: "${e.artifactStepResult.executionStatus}"`
        switch (e.artifactStepResult.executionStatus) {
          case ExecutionStatus.scheduled:
          case ExecutionStatus.running:
            options.log.debug(base)
            break
          case ExecutionStatus.aborted:
          case ExecutionStatus.done: {
            const s = `${base}, status: "${e.artifactStepResult.status}"`
            if (e.artifactStepResult.errors.length > 0) {
              options.log.debug(s)
              if (options.log.logLevel === LogLevel.debug || options.log.logLevel === LogLevel.trace) {
                e.artifactStepResult.errors.map(deserializeError).forEach(error => options.log.error('', error))
              }
            } else {
              options.log.debug(s)
            }
            break
          }
        }
        break
      }
    }
  }

  merge(
    ...options.steps.map(s => runStep({ stepIndex: s.index, allStepsEvents$, ...options, getState: () => fullState })),
  )
    .pipe(
      tap(logEvent),
      tap(e => {
        const stepResult = fullState.stepsResultOfArtifactsByStep[e.step.index].data
        switch (e.type) {
          case StepOutputEventType.step:
            stepResult.stepExecutionStatus = e.stepResult.executionStatus
            stepResult.stepResult = e.stepResult
            break
          case StepOutputEventType.artifactStep:
            stepResult.artifactsResult[e.artifact.index].data.artifactStepResult = e.artifactStepResult
            break
        }
        fullState.stepsResultOfArtifactsByArtifact = toStepsResultOfArtifactsByArtifact({
          artifacts: options.artifacts,
          stepsResultOfArtifactsByStep: fullState.stepsResultOfArtifactsByStep,
        })
      }),
      mergeMap(async e => {
        if (
          e.type === StepOutputEventType.artifactStep &&
          e.artifactStepResult.executionStatus === ExecutionStatus.done
        ) {
          await options.immutableCache.step.setArtifactStepResult({
            stepId: e.step.data.stepInfo.stepId,
            artifactHash: e.artifact.data.artifact.packageHash,
            artifactStepResult: e.artifactStepResult,
          })
        }
        if (e.type === StepOutputEventType.step && e.stepResult.executionStatus === ExecutionStatus.done) {
          await options.immutableCache.step.setStepResult({
            stepId: e.step.data.stepInfo.stepId,
            stepResult: e.stepResult,
          })
        }
        return e
      }),
      tap(e => allStepsEvents$.next(e)),
      tap(() => {
        // after all steps are done, close all streams
        const isFlowFinished = fullState.stepsResultOfArtifactsByStep.every(step =>
          [ExecutionStatus.aborted, ExecutionStatus.done].includes(step.data.stepExecutionStatus),
        )
        if (isFlowFinished) {
          allStepsEvents$.complete()
        }
      }),
    )
    .subscribe({
      complete: () => options.log.verbose(`ended to execute steps`),
    })

  for (const step of fullState.stepsResultOfArtifactsByStep) {
    allStepsEvents$.next({
      type: StepOutputEventType.step,
      step: options.steps[step.index],
      stepResult: {
        executionStatus: ExecutionStatus.scheduled,
      },
    })
    for (const artifact of step.data.artifactsResult) {
      allStepsEvents$.next({
        type: StepOutputEventType.artifactStep,
        step: options.steps[step.index],
        artifact: options.artifacts[artifact.index],
        artifactStepResult: {
          executionStatus: ExecutionStatus.scheduled,
        },
      })
    }
  }

  if (options.steps.length === 0) {
    allStepsEvents$.complete()
  }

  return allStepsEvents$
}
