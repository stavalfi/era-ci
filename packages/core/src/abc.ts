// import {
//   Artifact,
//   ExecutionStatus,
//   GitRepoInfo,
//   Graph,
//   PackageJson,
//   StepInfo,
//   StepOutputEvents,
//   StepOutputEventType,
//   StepRedisEvent,
// } from '@era-ci/utils'
// import _ from 'lodash'
// import { from, lastValueFrom, merge, Observable, Subject } from 'rxjs'
// import { defaultIfEmpty, filter, ignoreElements, map, mergeMap, tap } from 'rxjs/operators'
// import { deserializeError } from 'serialize-error'
// import { Log, Logger, LogLevel } from './create-logger'
// import { StepExperimental, toStepsResultOfArtifactsByArtifact } from './create-step'
// import { TaskQueueBase, TaskQueueOptions } from './create-task-queue'
// import { ImmutableCache } from './immutable-cache'
// import { RedisClient } from './redis-client'
// import { State } from './steps-execution'
// import { getEventsTopicName } from './utils'

// type Options = {
//   log: Log
//   gitRepoInfo: GitRepoInfo
//   rootPackageJson: PackageJson
//   // eslint-disable-next-line @typescript-eslint/no-explicit-any
//   taskQueues: Array<TaskQueueBase<any, any>>
//   repoPath: string
//   steps: Graph<{ stepInfo: StepInfo }>
//   stepsToRun: Graph<{
//     stepInfo: StepInfo
//     // eslint-disable-next-line @typescript-eslint/no-explicit-any
//     taskQueueClass: { new (options: TaskQueueOptions<any>): any }
//     // eslint-disable-next-line @typescript-eslint/no-explicit-any
//     runStep: StepExperimental<any>['runStep']
//   }>
//   flowId: string
//   repoHash: string
//   startFlowMs: number
//   immutableCache: ImmutableCache
//   logger: Logger
//   artifacts: Graph<{ artifact: Artifact }>
//   processEnv: NodeJS.ProcessEnv
//   redisClient: RedisClient
// }

// function runStep(
//   options: {
//     stepIndex: number
//     allStepsEvents$: Observable<StepOutputEvents[StepOutputEventType]>
//   } & Options & { getState: GetState },
// ): Observable<StepOutputEvents[StepOutputEventType]> {
//   const taskQueue = options.taskQueues.find(t => t instanceof options.stepsToRun[options.stepIndex].data.taskQueueClass)
//   if (!taskQueue) {
//     throw new Error(
//       `can't find task-queue: "${options.stepsToRun[options.stepIndex].data.taskQueueClass.name}" for step: "${
//         options.stepsToRun[options.stepIndex].data.stepInfo.displayName
//       }" needs. did you forgot to declare the task-queue in the configuration file?`,
//     )
//   }
//   function isRecursiveParent(stepIndex: number, possibleParentIndex: number): boolean {
//     return (
//       options.steps[stepIndex].parentsIndexes.includes(possibleParentIndex) ||
//       options.steps[stepIndex].parentsIndexes.some(p => isRecursiveParent(p, possibleParentIndex))
//     )
//   }

//   return options.stepsToRun[options.stepIndex].data.runStep(
//     { ...options, taskQueue, currentStepInfo: options.steps[options.stepIndex] },
//     options.allStepsEvents$.pipe(
//       filter(
//         e =>
//           // only allow events from recuresive-parent-steps or scheduled-events from current step.
//           isRecursiveParent(options.stepIndex, e.step.index) ||
//           (e.step.index === options.stepIndex &&
//             (e.type === StepOutputEventType.step
//               ? e.stepResult.executionStatus === ExecutionStatus.scheduled
//               : e.artifactStepResult.executionStatus === ExecutionStatus.scheduled)),
//       ),
//     ),
//   )
// }

// export async function runAllSteps(options: Options, state: Omit<State, 'getResult' | 'getReturnValue'>): Promise<void> {
//   options.log.verbose(`starting to execute steps`)

//   const logEvent = (e: StepOutputEvents[StepOutputEventType]) => {
//     switch (e.type) {
//       case StepOutputEventType.step: {
//         const base = `step: "${e.step.data.stepInfo.displayName}" - execution-status: "${e.stepResult.executionStatus}"`
//         switch (e.stepResult.executionStatus) {
//           case ExecutionStatus.scheduled:
//           case ExecutionStatus.running:
//             options.log.debug(base)
//             break
//           case ExecutionStatus.aborted:
//           case ExecutionStatus.done: {
//             const s = `${base}, status: "${e.stepResult.status}"`
//             if (e.stepResult.errors.length > 0) {
//               options.log.debug(s)
//               if (options.log.logLevel === LogLevel.debug || options.log.logLevel === LogLevel.trace) {
//                 e.stepResult.errors.map(deserializeError).forEach(error => options.log.error('', error))
//               }
//             } else {
//               options.log.debug(s)
//             }
//             break
//           }
//         }
//         break
//       }
//       case StepOutputEventType.artifactStep: {
//         const base = `step: "${e.step.data.stepInfo.displayName}", artifact: "${e.artifact.data.artifact.packageJson.name}" - execution-status: "${e.artifactStepResult.executionStatus}"`
//         switch (e.artifactStepResult.executionStatus) {
//           case ExecutionStatus.scheduled:
//           case ExecutionStatus.running:
//             options.log.debug(base)
//             break
//           case ExecutionStatus.aborted:
//           case ExecutionStatus.done: {
//             const s = `${base}, status: "${e.artifactStepResult.status}"`
//             if (e.artifactStepResult.errors.length > 0) {
//               options.log.debug(s)
//               if (options.log.logLevel === LogLevel.debug || options.log.logLevel === LogLevel.trace) {
//                 e.artifactStepResult.errors.map(deserializeError).forEach(error => options.log.error('', error))
//               }
//             } else {
//               options.log.debug(s)
//             }
//             break
//           }
//         }
//         break
//       }
//     }
//   }

//   const allStepsEvents$ = new Subject<StepOutputEvents[StepOutputEventType]>()

//   merge(...options.steps.map(s => runStep({ stepIndex: s.index, allStepsEvents$, ...options, getState: () => state })))
//     .pipe(
//       tap(logEvent),
//       map<
//         StepOutputEvents[StepOutputEventType],
//         [{ event: StepOutputEvents[StepOutputEventType]; redisCommands: string[][] }]
//       >(event => {
//         const redisCommands: string[][] = []
//         if (
//           event.type === StepOutputEventType.artifactStep &&
//           event.artifactStepResult.executionStatus === ExecutionStatus.done
//         ) {
//           redisCommands.push(
//             options.immutableCache.step.setArtifactStepResultResipe({
//               stepId: event.step.data.stepInfo.stepId,
//               artifactHash: event.artifact.data.artifact.packageHash,
//               artifactStepResult: event.artifactStepResult,
//             }),
//           )
//         }
//         if (event.type === StepOutputEventType.step && event.stepResult.executionStatus === ExecutionStatus.done) {
//           redisCommands.push(
//             options.immutableCache.step.setStepResultResipe({
//               stepId: event.step.data.stepInfo.stepId,
//               stepResult: event.stepResult,
//             }),
//           )
//         }
//         redisCommands.push([
//           'publish',
//           getEventsTopicName(options.processEnv),
//           JSON.stringify(
//             _.identity<StepRedisEvent>({
//               flowId: options.flowId,
//               gitCommit: options.gitRepoInfo.commit,
//               repoName: options.gitRepoInfo.repoName,
//               repoHash: options.repoHash,
//               startFlowMs: options.startFlowMs,
//               event,
//             }),
//           ),
//         ])

//         return [{ event, redisCommands }]
//       }),
//       // bufferTime(500),
//       filter(array => array.length > 0),
//       mergeMap(async array => {
//         const commands = _.flatten(array.map(({ redisCommands }) => redisCommands))
//         const results: Array<[Error | null, unknown]> = await options.redisClient.connection.multi(commands).exec()
//         if (results.some(([error]) => error)) {
//           throw results
//         }
//         return array.map(({ event }) => event)
//       }),
//       mergeMap(events => from(events)),
//       tap(e => {
//         const stepResult = state.stepsResultOfArtifactsByStep[e.step.index].data
//         switch (e.type) {
//           case StepOutputEventType.step:
//             stepResult.stepExecutionStatus = e.stepResult.executionStatus
//             stepResult.stepResult = e.stepResult
//             break
//           case StepOutputEventType.artifactStep:
//             stepResult.artifactsResult[e.artifact.index].data.artifactStepResult = e.artifactStepResult
//             break
//         }
//         state.stepsResultOfArtifactsByArtifact = toStepsResultOfArtifactsByArtifact({
//           artifacts: options.artifacts,
//           stepsResultOfArtifactsByStep: state.stepsResultOfArtifactsByStep,
//         })

//         allStepsEvents$.next(e)

//         // after all steps are done, close all streams
//         const isFlowFinished = state.stepsResultOfArtifactsByStep.every(step =>
//           [ExecutionStatus.aborted, ExecutionStatus.done].includes(step.data.stepExecutionStatus),
//         )

//         if (isFlowFinished) {
//           allStepsEvents$.complete()
//         }
//       }),
//     )
//     .subscribe({
//       complete: () => options.log.verbose(`ended to execute steps`),
//     })

//   for (const step of state.stepsResultOfArtifactsByStep) {
//     allStepsEvents$.next({
//       type: StepOutputEventType.step,
//       step: options.steps[step.index],
//       stepResult: {
//         executionStatus: ExecutionStatus.scheduled,
//       },
//     })
//     for (const artifact of step.data.artifactsResult) {
//       allStepsEvents$.next({
//         type: StepOutputEventType.artifactStep,
//         step: options.steps[step.index],
//         artifact: options.artifacts[artifact.index],
//         artifactStepResult: {
//           executionStatus: ExecutionStatus.scheduled,
//         },
//       })
//     }
//   }

//   if (options.steps.length === 0) {
//     allStepsEvents$.complete()
//   }

//   await lastValueFrom(allStepsEvents$.pipe(ignoreElements(), defaultIfEmpty()))
// }
