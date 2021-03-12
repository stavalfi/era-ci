import {
  AbortResult,
  Artifact,
  calculateCombinedStatus,
  Cleanup,
  didPassOrSkippedAsPassed,
  DoneResult,
  execaCommand,
  ExecutionStatus,
  Graph,
  RunningResult,
  ScheduledResult,
  Status,
  StepInfo,
  toFlowLogsContentKey,
} from '@era-ci/utils'
import fs from 'fs'
import _ from 'lodash'
import { Log, Logger } from './create-logger'
import { ImmutableCache } from './immutable-cache'
import type { State } from './steps-execution'

export function getEventsTopicName(env: NodeJS.ProcessEnv): string {
  const topic = 'era-ci-events'
  const postfix = env['ERA_CI_EVENTS_TOPIC_PREFIX']
  if (postfix) {
    return `${topic}-${postfix}`
  } else {
    return topic
  }
}

export function getExitCode(state: State): number {
  const finalStepsStatus = calculateCombinedStatus(
    _.flatMapDeep(
      state.stepsResultOfArtifactsByStep.map(s => {
        switch (s.data.stepExecutionStatus) {
          case ExecutionStatus.done:
            return s.data.artifactsResult.map(y => y.data.artifactStepResult.status)
          case ExecutionStatus.aborted:
            return s.data.artifactsResult.map(y => y.data.artifactStepResult.status)
          case ExecutionStatus.running:
            return [Status.failed]
          case ExecutionStatus.scheduled:
            return [Status.failed]
        }
      }),
    ),
  )
  if (didPassOrSkippedAsPassed(finalStepsStatus)) {
    return 0
  } else {
    return 1
  }
}

export const getResult = (
  options: {
    state: State
    artifacts: Graph<{ artifact: Artifact }>
    steps: Graph<{ stepInfo: StepInfo }>
    artifactName: string
  } & ({ stepId: string } | { stepGroup: string }),
):
  | ScheduledResult
  | RunningResult
  | DoneResult
  | AbortResult<Status.skippedAsFailed | Status.skippedAsPassed | Status.failed> => {
  const artifactIndex = options.artifacts.findIndex(a => a.data.artifact.packageJson.name === options.artifactName)
  if (artifactIndex < 0) {
    throw new Error(`artifactName: "${options.artifactName}" not found`)
  }

  const stepIndex = options.steps.findIndex(a =>
    'stepId' in options ? a.data.stepInfo.stepId === options.stepId : a.data.stepInfo.stepGroup === options.stepGroup,
  )
  if (stepIndex < 0) {
    if ('stepId' in options) {
      throw new Error(`'step-id': "${options.stepId}" not found`)
    } else {
      throw new Error(`'step-group': "${options.stepGroup}" not found`)
    }
  }

  return options.state.stepsResultOfArtifactsByStep[stepIndex].data.artifactsResult[artifactIndex].data
    .artifactStepResult
}

export const getReturnValue = <T>(
  options: {
    state: State
    artifacts: Graph<{ artifact: Artifact }>
    steps: Graph<{ stepInfo: StepInfo }>
    artifactName: string
    mapper: (val?: string) => T
    allowUndefined?: boolean
  } & ({ stepId: string } | { stepGroup: string }),
): T => {
  const artifactStepResult = getResult(options)
  if (
    artifactStepResult.executionStatus !== ExecutionStatus.aborted &&
    artifactStepResult.executionStatus !== ExecutionStatus.done
  ) {
    if ('stepId' in options) {
      throw new Error(`'step-id': "${options.stepId}" not done yet so we can't get it's return value`)
    } else {
      throw new Error(`'step-group': "${options.stepGroup}" not done yet so we can't get it's return value`)
    }
  }
  const result = options.mapper(artifactStepResult.returnValue)
  if (result === undefined) {
    throw new Error(`invalid return-value from step: "undefined"`)
  }
  return result
}

export async function checkIfAllChangesCommitted({ repoPath, log }: { repoPath: string; log: Log }) {
  const diffIsEmpty = await execaCommand(`git diff-index --quiet HEAD --`, {
    stdio: 'ignore',
    log,
    cwd: repoPath,
  }).then(
    () => true,
    () => false,
  )
  // not ignored and untracked files
  const noUnteackedFiles = await execaCommand(`git ls-files --exclude-standard --others`, {
    stdio: 'pipe',
    log,
    cwd: repoPath,
  }).then(({ stdout = '' }) => stdout.length === 0)

  if (!diffIsEmpty) {
    log.error(`found uncommited changes. please commit the following files:`)
    await execaCommand(`git diff --name-only`, {
      stdio: 'inherit',
      log,
      cwd: repoPath,
    })
  }
  if (!noUnteackedFiles) {
    log.error(`found untracked files. please remove/commit the following files:`)
    await execaCommand(`git ls-files --exclude-standard --others`, {
      stdio: 'inherit',
      log,
      cwd: repoPath,
    })
  }

  return diffIsEmpty && noUnteackedFiles
}

export async function finishFlow({
  flowId,
  log,
  fatalError,
  logger,
  immutableCache,
  processExitCode,
  repoHash,
  steps,
  cleanups,
  connectionsCleanups,
  processEnv,
}: {
  flowId: string
  fatalError: boolean
  repoHash?: string
  immutableCache?: ImmutableCache
  log?: Log
  logger?: Logger
  steps?: Graph<{ stepInfo: StepInfo }>
  processExitCode: number
  cleanups: Cleanup[]
  connectionsCleanups: Cleanup[]
  processEnv: NodeJS.ProcessEnv
}) {
  if (immutableCache && logger) {
    await immutableCache.set({
      key: toFlowLogsContentKey(flowId),
      value: await fs.promises.readFile(logger.logFilePath, 'utf-8'),
      asBuffer: true,
      ttl: immutableCache.ttls.flowLogs,
    })
  }
  await Promise.all(cleanups.map(f => f().catch(e => log?.error(`cleanup function failed to run`, e))))
  await Promise.all(
    connectionsCleanups.map(f => f().catch(e => log?.error(`cleanup function of a connection failed to run`, e))),
  )

  // 'SKIP_EXIT_CODE_1' is for test purposes
  if (!processEnv['SKIP_EXIT_CODE_1']) {
    process.exitCode = processExitCode
  }

  // jest don't print last 2 console.log lines so it's a workaround
  if (processEnv['ERA_TEST_MODE']) {
    // eslint-disable-next-line no-console
    console.log('------------------------')
    // eslint-disable-next-line no-console
    console.log('------------------------')
    // eslint-disable-next-line no-console
    console.log('------------------------')
  }

  return {
    flowId,
    repoHash,
    steps,
    passed: processExitCode === 0,
    fatalError,
  }
}
