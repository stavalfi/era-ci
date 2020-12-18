import { Artifact, ExecutionStatus, Graph, PackageJson } from '@tahini/utils'
import _ from 'lodash'
import { merge, Observable, Subject, Subscription } from 'rxjs'
import { filter, tap } from 'rxjs/operators'
import { Logger } from './create-logger'
import {
  StepExperimental,
  StepInfo,
  StepOutputEvents,
  StepOutputEventType,
  StepResultOfArtifacts,
  StepsResultOfArtifactsByArtifact,
  StepsResultOfArtifactsByStep,
  toStepsResultOfArtifactsByArtifact,
} from './create-step'
import { TaskQueueBase, TaskQueueOptions } from './create-task-queue'
import { ImmutableCache } from './immutable-cache'

type State = {
  stepsResultOfArtifactsByStep: StepsResultOfArtifactsByStep
  stepsResultOfArtifactsByArtifact: StepsResultOfArtifactsByArtifact
}

type Options = {
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
} & State

function updateState({
  stepIndex,
  state,
  stepResultOfArtifacts,
  artifacts,
}: {
  state: State
  stepIndex: number
  stepResultOfArtifacts: StepResultOfArtifacts
  artifacts: Graph<{ artifact: Artifact }>
}) {
  const clone = _.cloneDeep(state.stepsResultOfArtifactsByStep)
  clone[stepIndex].data = stepResultOfArtifacts
  state.stepsResultOfArtifactsByStep = clone
  state.stepsResultOfArtifactsByArtifact = toStepsResultOfArtifactsByArtifact({
    artifacts,
    stepsResultOfArtifactsByStep: state.stepsResultOfArtifactsByStep,
  })
}

function runStep(
  options: {
    stepIndex: number
    allStepsEvents$: Observable<StepOutputEvents[StepOutputEventType]>
  } & Options &
    State,
): Observable<StepOutputEvents[StepOutputEventType]> {
  const taskQueue = options.taskQueues.find(t => t instanceof options.stepsToRun[options.stepIndex].data.taskQueueClass)
  if (!taskQueue) {
    throw new Error(
      `can't find task-queue: "${options.stepsToRun[options.stepIndex].data.taskQueueClass.name}" for step: "${
        options.stepsToRun[options.stepIndex].data.stepInfo.displayName
      }" needs. did you forgot to declare the task-queue in the configuration file?`,
    )
  }
  return options.stepsToRun[options.stepIndex].data.runStep(
    { ...options, taskQueue, currentStepInfo: options.steps[options.stepIndex] },
    options.allStepsEvents$.pipe(
      filter(
        e =>
          // only allow events from parent-steps or scheduled-events from current step.
          options.steps[options.stepIndex].parentsIndexes.includes(e.step.index) ||
          (e.step.index === options.stepIndex &&
            (e.type === StepOutputEventType.step
              ? e.stepResult.executionStatus === ExecutionStatus.scheduled
              : e.artifactStepResult.executionStatus === ExecutionStatus.scheduled)),
      ),
    ),
  )
}

export function runAllSteps(options: Options) {
  const state: State = {
    stepsResultOfArtifactsByArtifact: options.stepsResultOfArtifactsByArtifact,
    stepsResultOfArtifactsByStep: options.stepsResultOfArtifactsByStep,
  }

  const allStepsEvents$ = new Subject<StepOutputEvents[StepOutputEventType]>()

  const subscription: Subscription = merge(
    ...options.steps.map(s => runStep({ stepIndex: s.index, allStepsEvents$, ...options, ...state })),
  )
    .pipe(
      tap(e => {
        const stepResultClone = _.cloneDeep(state.stepsResultOfArtifactsByStep[e.step.index].data)
        switch (e.type) {
          case StepOutputEventType.step:
            stepResultClone.stepResult = e.stepResult
            break
          case StepOutputEventType.artifactStep:
            stepResultClone.artifactsResult[e.artifact.index].data.artifactStepResult = e.artifactStepResult
        }
        updateState({
          state,
          artifacts: options.artifacts,
          stepIndex: e.step.index,
          stepResultOfArtifacts: stepResultClone,
        })
      }),
      tap(e => allStepsEvents$.next(e)),
      tap(() => {
        // after all steps are done, close all streams
        const isFlowFinished = state.stepsResultOfArtifactsByStep.every(step =>
          [ExecutionStatus.aborted, ExecutionStatus.done].includes(step.data.stepExecutionStatus),
        )
        if (isFlowFinished) {
          allStepsEvents$.complete()
          subscription.unsubscribe()
        }
      }),
    )
    .subscribe()

  for (const step of state.stepsResultOfArtifactsByStep) {
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

  return allStepsEvents$
}
